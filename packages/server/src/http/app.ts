import { isAgentReady, resolveAgent } from "../modules/ai/settings.service.js";
/**
 * Express-приложение: маршруты, статика панели и виджета, безопасность.
 */
import path from "node:path";
import fs from "node:fs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type Response } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { API_PREFIX } from "@sova/shared";
import { config } from "../config.js";
import { logger } from "../infra/logger.js";
import { serverRoot } from "../infra/paths.js";
import { pingDb } from "../infra/db.js";
import { pingRedis } from "../infra/redis.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { clientRouter } from "./routes/client.routes.js";
import { conversationsRouter } from "./routes/conversations.routes.js";
import { filesRouter } from "./routes/files.routes.js";
import {
  errorHandler,
  notFoundHandler,
  requireCsrf,
  requireOperator,
} from "./middleware.js";
import "./types.js";

export function createApp(): Express {
  const app = express();

  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/api/v1/health" || req.url === "/healthz",
      },
    }),
  );

  app.use(
    helmet({
      // Виджет встраивается на сторонние сайты, поэтому запрещать фреймы нельзя.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );

  app.use(cookieParser());

  // CORS: панель — тот же origin; клиентские маршруты доступны с сайтов клиентов,
  // но защищены session_token, а домены проверяются при создании сессии.
  app.use(
    cors({
      origin: true,
      credentials: true,
      allowedHeaders: ["content-type", "authorization", "x-sova-session", "x-sova-csrf"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  // Загрузка изображений — «сырым» телом запроса.
  app.use(
    express.raw({
      type: ["image/*", "video/mp4", "video/webm", "application/octet-stream"],
      limit: Math.max(config.storage.maxUploadBytes,32*1024*1024),
    }),
  );

  /* ── Служебные маршруты ── */
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get(`${API_PREFIX}/health`, (_req, res) => {
    void (async () => {
      const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
      res.status(db && redis ? 200 : 503).json({
        ok: db && redis,
        db,
        redis,
        ai: await isAgentReady("support"),
        version: "0.1.0",
        time: new Date().toISOString(),
      });
    })();
  });

  /* ── Клиентский API (виджет, SDK) ── */
  app.use(`${API_PREFIX}/client`, clientRouter);

  /* ── Файлы (доступ проверяется внутри) ── */
  app.use(`${API_PREFIX}/files`, filesRouter);

  /* ── Панель оператора ── */
  app.use(`${API_PREFIX}/auth`, requireCsrf, authRouter);
  app.use(`${API_PREFIX}/conversations`, requireCsrf, requireOperator, conversationsRouter);
  app.use(`${API_PREFIX}/admin`, requireCsrf, requireOperator, adminRouter);

  /* ── Статика: виджет и собранная панель ── */
  serveStatic(app);

  app.use(`${API_PREFIX}`, notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * widget.js отдаётся с корня домена, чтобы подключение было одной строкой.
 * Панель — SPA: любые неизвестные пути возвращают index.html.
 */
function serveStatic(app: Express): void {
  const widgetDist = path.resolve(serverRoot, "..", "widget", "dist");
  const panelDist = path.resolve(serverRoot, "..", "panel", "dist");

  if (fs.existsSync(widgetDist)) {
    app.use(
      "/widget",
      express.static(widgetDist, { maxAge: "5m", setHeaders: setCrossOriginHeaders }),
    );
    app.get("/widget.js", (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.type("application/javascript").sendFile(path.join(widgetDist, "widget.js"));
    });
  } else {
    logger.warn({ widgetDist }, "Сборка виджета не найдена — запустите npm run build -w @sova/widget");
  }

  if (fs.existsSync(panelDist)) {
    app.use(express.static(panelDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api|socket\.io|widget).*/, (_req, res) => {
      res.sendFile(path.join(panelDist, "index.html"));
    });
  } else {
    logger.warn({ panelDist }, "Сборка панели не найдена — запустите npm run build -w @sova/panel");
  }
}

function setCrossOriginHeaders(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
}
