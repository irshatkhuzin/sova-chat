/**
 * Конфигурация сервера. Читается один раз при старте и валидируется.
 * Секреты берутся только из окружения и никогда не попадают в логи и ответы API.
 */
import { z } from "zod";
import path from "node:path";
import dotenv from "dotenv";
import { projectRoot } from "./infra/paths.js";

dotenv.config({ path: path.join(projectRoot, ".env") });

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const numberish = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numberish(4000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  PANEL_URL: z.string().default("http://localhost:5173"),
  TRUST_PROXY: boolish,

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: numberish(3306),
  DB_USER: z.string().default("sova"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("sova"),
  DB_CONNECTION_LIMIT: numberish(10),

  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: numberish(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: numberish(0),
  REDIS_TLS: boolish,
  REDIS_PREFIX: z.string().default("sova"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET должен быть не короче 32 символов"),
  APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY должен быть не короче 32 символов"),
  ACCESS_TOKEN_TTL_MIN: numberish(30),
  REFRESH_TOKEN_TTL_DAYS: numberish(30),
  CLIENT_SESSION_TTL_DAYS: numberish(180),

  AI_PROVIDER: z.enum(["openai"]).default("openai"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_TRANSLATION_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TIMEOUT_MS: numberish(45_000),
  OPENAI_MAX_RETRIES: numberish(2),
  OPENAI_PRICE_INPUT_PER_MTOK: numberish(2.5),
  OPENAI_PRICE_OUTPUT_PER_MTOK: numberish(10),
  OPENAI_TRANSLATION_PRICE_INPUT_PER_MTOK: numberish(0.15),
  OPENAI_TRANSLATION_PRICE_OUTPUT_PER_MTOK: numberish(0.6),

  TRANSLATION_PROVIDER: z.enum(["llm"]).default("llm"),
  OPERATOR_LANGUAGE: z.string().default("ru"),

  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  MAX_UPLOAD_BYTES: numberish(5 * 1024 * 1024),
  ALLOWED_UPLOAD_MIME: z.string().default("image/png,image/jpeg,image/gif,image/webp"),

  MAX_MESSAGE_LENGTH: numberish(4000),
  RATE_LIMIT_CLIENT_MESSAGES_PER_MIN: numberish(20),
  RATE_LIMIT_CLIENT_SESSIONS_PER_HOUR: numberish(30),
  RATE_LIMIT_LOGIN_PER_15MIN: numberish(10),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(""),

  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // Никаких значений в выводе — только имена переменных.
  throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  host: env.HOST,
  publicUrl: env.PUBLIC_URL.replace(/\/+$/, ""),
  basePath: new URL(env.PUBLIC_URL).pathname.replace(/\/+$/, ""),
  panelUrl: env.PANEL_URL.replace(/\/+$/, ""),
  trustProxy: env.TRUST_PROXY,

  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_CONNECTION_LIMIT,
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    tls: env.REDIS_TLS,
    prefix: env.REDIS_PREFIX,
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    encryptionKey: env.APP_ENCRYPTION_KEY,
    accessTokenTtlMin: env.ACCESS_TOKEN_TTL_MIN,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    clientSessionTtlDays: env.CLIENT_SESSION_TTL_DAYS,
  },

  ai: {
    provider: env.AI_PROVIDER,
    /** ИИ считается настроенным только при наличии ключа. */
    get enabled(): boolean {
      return env.OPENAI_API_KEY.length > 0;
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL.replace(/\/+$/, ""),
      model: env.OPENAI_MODEL,
      translationModel: env.OPENAI_TRANSLATION_MODEL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
      priceInputPerMTok: env.OPENAI_PRICE_INPUT_PER_MTOK,
      priceOutputPerMTok: env.OPENAI_PRICE_OUTPUT_PER_MTOK,
      translationPriceInputPerMTok: env.OPENAI_TRANSLATION_PRICE_INPUT_PER_MTOK,
      translationPriceOutputPerMTok: env.OPENAI_TRANSLATION_PRICE_OUTPUT_PER_MTOK,
    },
  },

  translation: {
    provider: env.TRANSLATION_PROVIDER,
    operatorLanguage: env.OPERATOR_LANGUAGE,
  },

  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    allowedMime: env.ALLOWED_UPLOAD_MIME.split(",").map((s) => s.trim()).filter(Boolean),
  },

  limits: {
    maxMessageLength: env.MAX_MESSAGE_LENGTH,
    clientMessagesPerMin: env.RATE_LIMIT_CLIENT_MESSAGES_PER_MIN,
    clientSessionsPerHour: env.RATE_LIMIT_CLIENT_SESSIONS_PER_HOUR,
    loginPer15Min: env.RATE_LIMIT_LOGIN_PER_15MIN,
  },

  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    adminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
    get enabled(): boolean {
      return env.TELEGRAM_BOT_TOKEN.length > 0 && env.TELEGRAM_ADMIN_CHAT_ID.length > 0;
    },
  },

  logLevel: env.LOG_LEVEL,
} as const;

export type AppConfig = typeof config;
