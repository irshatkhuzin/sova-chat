/** Вход в панель оператора. */
import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { errors } from "../../infra/errors.js";
import {
  login,
  logout,
  refresh,
  type LoginResult,
} from "../../modules/auth/operator-auth.service.js";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  asyncHandler,
  clientIp,
  rateLimit,
  requireOperator,
} from "../middleware.js";
import type { Response } from "express";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(1).max(200),
});

function setAuthCookies(res: Response, result: LoginResult): void {
  const secure = config.isProduction;
  res.cookie(ACCESS_COOKIE, result.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: `${config.basePath}/`,
    expires: result.accessTokenExpiresAt,
  });
  res.cookie(REFRESH_COOKIE, result.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: `${config.basePath}/api/v1/auth`,
    expires: result.refreshTokenExpiresAt,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: `${config.basePath}/` });
  res.clearCookie(REFRESH_COOKIE, { path: `${config.basePath}/api/v1/auth` });
}

authRouter.post(
  "/login",
  rateLimit({ name: "login", limit: config.limits.loginPer15Min, windowSec: 900 }),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await login(input.email, input.password, {
      ip: clientIp(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });
    setAuthCookies(res, result);
    res.json({ operator: result.operator, expiresAt: result.accessTokenExpiresAt.toISOString() });
  }),
);

authRouter.post(
  "/refresh",
  rateLimit({ name: "refresh", limit: 60, windowSec: 900 }),
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw errors.unauthorized("Сессия истекла, войдите заново");
    const result = await refresh(token, {
      ip: clientIp(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });
    setAuthCookies(res, result);
    res.json({ operator: result.operator, expiresAt: result.accessTokenExpiresAt.toISOString() });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireOperator,
  asyncHandler(async (req, res) => {
    res.json({ operator: req.operatorCtx?.operator ?? null });
  }),
);
