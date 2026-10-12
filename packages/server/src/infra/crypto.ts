/**
 * Криптографические примитивы: шифрование секретов каналов, хеши токенов,
 * генерация публичных идентификаторов, проверка подписи внешних токенов.
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT = Buffer.from("sova-secret-box-v1");

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto.scryptSync(config.auth.encryptionKey, SALT, KEY_LENGTH);
  }
  return cachedKey;
}

/** Шифрует строку для хранения в базе. Формат: v1.<iv>.<tag>.<payload> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Некорректный формат зашифрованного секрета");
  }
  const iv = Buffer.from(parts[1] as string, "base64url");
  const tag = Buffer.from(parts[2] as string, "base64url");
  const payload = Buffer.from(parts[3] as string, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomPublicId(): string {
  // 16 байт → 32 hex-символа, помещается в CHAR(32).
  return crypto.randomBytes(16).toString("hex");
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Сравнение без утечки по времени. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}
