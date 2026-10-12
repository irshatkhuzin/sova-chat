/** Логирование. Секреты и персональные данные вырезаются перед записью. */
import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-sova-session']",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.token",
      "*.sessionToken",
      "*.authToken",
      "*.refreshToken",
      "*.apiKey",
      "*.authSecret",
      "*.auth_secret_enc",
      "config.auth",
      "config.ai.openai.apiKey",
    ],
    censor: "[скрыто]",
  },
  base: { service: "sova" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** Логгер модуля: logger.child({ module }) с одинаковым форматом по всему проекту. */
export function moduleLogger(name: string) {
  return logger.child({ module: name });
}
