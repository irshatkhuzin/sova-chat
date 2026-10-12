/** Middleware: авторизация, CSRF, ограничение частоты, обработка ошибок. */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { ErrorCodes, type ApiErrorBody } from "@sova/shared";
import { config } from "../config.js";
import { AppError, errors, isAppError } from "../infra/errors.js";
import { moduleLogger } from "../infra/logger.js";
import { getRedis, key } from "../infra/redis.js";
import { resolveClientSession } from "../modules/auth/client-session.service.js";
import {
  assertSessionActive,
  findOperatorById,
  verifyAccessToken,
} from "../modules/auth/operator-auth.service.js";
import "./types.js";
import { normalizeIp, saveEnvironment } from "../modules/users/client-environment.service.js";
import { execute } from "../infra/db.js";
const environmentSeen=new Map<string,number>();

const log = moduleLogger("http");

export const ACCESS_COOKIE = "sova_at";
export const REFRESH_COOKIE = "sova_rt";

/** Обёртка для асинхронных обработчиков: любые ошибки уходят в errorHandler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const requireOperator: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const cookieToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
      const header = req.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      const token = cookieToken ?? bearer;
      if (!token) throw errors.unauthorized();

      const payload = verifyAccessToken(token);
      await assertSessionActive(payload.sid);
      const operator = await findOperatorById(payload.sub);
      if (!operator || !operator.isActive) throw errors.unauthorized("Учётная запись недоступна");

      req.operatorCtx = { operator, sessionId: payload.sid };
      next();
    } catch (err) {
      next(err);
    }
  })();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.operatorCtx?.operator.role !== "admin") {
    next(errors.forbidden("Действие доступно только администратору"));
    return;
  }
  next();
};

/**
 * Защита от CSRF: панель работает с cookie того же origin и обязана отправлять
 * заголовок X-Sova-Csrf. Браузер не добавит его при обычной межсайтовой отправке формы.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.headers["x-sova-csrf"] !== "1") {
    next(errors.forbidden("Отсутствует заголовок X-Sova-Csrf"));
    return;
  }
  const origin = req.headers.origin;
  const allowedOrigins = [new URL(config.publicUrl).origin, new URL(config.panelUrl).origin];
  if (origin && !allowedOrigins.includes(origin)) {
    next(errors.forbidden("Недопустимый источник запроса панели"));
    return;
  }
  next();
};

/** Авторизация клиента (виджет, SDK) по session_token. */
export const requireClientSession: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      const custom = req.headers["x-sova-session"];
      const token = bearer ?? (typeof custom === "string" ? custom : undefined);
      if (!token) throw errors.unauthorized("Нет сессии");

      req.clientCtx = await resolveClientSession(token);
      req.clientToken = token;
      const sid=req.clientCtx.sessionId;
      if(Date.now()-(environmentSeen.get(sid)??0)>60000){
        if(environmentSeen.size>2000)environmentSeen.clear();
        environmentSeen.set(sid,Date.now());
        const ip=normalizeIp(clientIp(req));
        const ua=req.headers['user-agent']?.slice(0,255)??null;
        void (async()=>{
          await execute('UPDATE sova_end_user_sessions SET ip=COALESCE(?,ip),user_agent=COALESCE(?,user_agent) WHERE id=?',[ip,ua,sid]);
          await saveEnvironment(sid,req.headers['accept-language']);
        })().catch(()=>environmentSeen.delete(sid));
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
};

export function clientIp(req: Request): string {
  const remote=normalizeIp(req.socket.remoteAddress)??'unknown';
  // Only our loopback reverse proxy can supply an address; Nginx overwrites X-Real-IP.
  if(config.trustProxy && (remote==='127.0.0.1'||remote==='::1')) {
    const header=req.headers['x-real-ip'];
    if(typeof header==='string'&&normalizeIp(header))return normalizeIp(header)!;
    const forwarded=req.headers['x-forwarded-for'];
    if(typeof forwarded==='string')return normalizeIp(forwarded.split(',').at(-1))??remote;
  }
  return remote;
}

/**
 * Ограничение частоты запросов на Redis.
 * При недоступности Redis запрос пропускается: доступность важнее строгости лимита.
 */
export function rateLimit(options: {
  name: string;
  limit: number;
  windowSec: number;
  keyFn?: (req: Request) => string;
}): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const subject = options.keyFn ? options.keyFn(req) : clientIp(req);
        const bucketKey = key("rl", options.name, subject);
        const redis = getRedis();
        const count = await redis.incr(bucketKey);
        if (count === 1) await redis.expire(bucketKey, options.windowSec);
        if (count > options.limit) {
          const ttl=await redis.ttl(bucketKey);
          res.setHeader('Retry-After',String(Math.max(1,ttl>0?ttl:options.windowSec)));
          next(errors.rateLimited("Слишком много запросов, попробуйте позже"));
          return;
        }
        next();
      } catch (err) {
        log.warn({ err: String(err), limiter: options.name }, "Лимитер недоступен, пропускаю запрос");
        next();
      }
    })();
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = {
    error: { code: ErrorCodes.NotFound, message: "Метод не найден" },
  };
  res.status(404).json(body);
};

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError: AppError = isAppError(err)
    ? err
    : err && typeof err==='object' && 'type' in err && err.type==='entity.too.large'
      ? errors.tooLarge("Размер загрузки превышает допустимый лимит")
    : err instanceof ZodError
      ? errors.validation("Проверьте заполнение полей и допустимую длину текста", err.issues.map(issue=>({field:issue.path.join('.'),code:issue.code})))
      : errors.internal(err instanceof Error ? err.message : "Неизвестная ошибка");

  if (appError.status >= 500) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), path: req.path, method: req.method },
      "Ошибка обработки запроса",
    );
  } else {
    log.debug({ code: appError.code, path: req.path }, "Отклонён запрос");
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : "Внутренняя ошибка сервера",
    },
  };
  if (appError.details !== undefined && appError.expose) {
    body.error.details = appError.details;
  }

  res.status(appError.status).json(body);
}
