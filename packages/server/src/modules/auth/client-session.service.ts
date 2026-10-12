/**
 * Сессии клиентов (виджет на сайте, Android SDK).
 *
 * Публичный идентификатор канала (public_id) не является секретом: он позволяет
 * только создать сессию в рамках своего канала. Доступ к переписке даёт лишь
 * session_token, который сервер выдаёт и хранит в виде SHA-256.
 *
 * Авторизованный пользователь подтверждается токеном, подписанным HMAC-SHA256
 * секретом канала на стороне вашего продукта. Одному userId из браузера доверять
 * нельзя, поэтому без подписи пользователь остаётся анонимным.
 */
import type { RowDataPacket } from "mysql2/promise";
import { normalizeLanguage } from "@sova/shared";
import { config } from "../../config.js";
import { execute, queryOne, idToString } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { hmacSha256, randomToken, sha256Hex, timingSafeEqual, uuid } from "../../infra/crypto.js";
import { moduleLogger } from "../../infra/logger.js";
import type { ChannelRow } from "../channels/channel.service.js";
import { getChannelSecret } from "../channels/channel.service.js";
import {
  createEndUser,
  findVerifiedUser,
  getEndUserRow,
  touchEndUser,
  type EndUserRow,
} from "../users/end-user.service.js";

const log = moduleLogger("client-session");

export interface ClientSessionContext {
  sessionId: string;
  endUser: EndUserRow;
  channel: ChannelRow;
  visitorKey: string;
}

export interface SignedUserPayload {
  externalId: string;
  name?: string;
  email?: string;
  exp?: number;
}

/**
 * Разбирает и проверяет подписанный токен пользователя.
 * Формат: base64url(JSON).hex(HMAC-SHA256(secret, base64url(JSON)))
 */
export function verifySignedUserToken(token: string, secret: string): SignedUserPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw errors.unauthorized("Некорректный токен пользователя");
  const [payloadB64, signature] = parts as [string, string];

  const expected = hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(expected, signature.toLowerCase())) {
    throw errors.unauthorized("Подпись токена пользователя неверна");
  }

  let payload: SignedUserPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw errors.unauthorized("Некорректное содержимое токена пользователя");
  }

  if (!payload.externalId || typeof payload.externalId !== "string") {
    throw errors.unauthorized("В токене отсутствует externalId");
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw errors.unauthorized("Токен пользователя истёк");
  }
  return payload;
}

/** Вспомогательная функция для документации и тестов: как продукт подписывает токен. */
export function signUserToken(payload: SignedUserPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${hmacSha256(secret, payloadB64)}`;
}

interface CreateSessionInput {
  channel: ChannelRow;
  visitorKey?: string;
  authToken?: string;
  languageHint?: string;
  ip?: string;
  userAgent?: string;
}

export interface CreatedSession {
  sessionToken: string;
  sessionId: string;
  visitorKey: string;
  expiresAt: Date;
  endUser: EndUserRow;
}

export async function createClientSession(input: CreateSessionInput): Promise<CreatedSession> {
  const productId = idToString(input.channel.product_id);
  const channelId = idToString(input.channel.id);
  const language = normalizeLanguage(input.languageHint);

  let endUser: EndUserRow | null = null;
  let visitorKey = input.visitorKey && /^[0-9a-f-]{36}$/i.test(input.visitorKey)
    ? input.visitorKey
    : null;

  if (input.authToken) {
    const secret = getChannelSecret(input.channel);
    const payload = verifySignedUserToken(input.authToken, secret);
    endUser = await findVerifiedUser(productId, payload.externalId);
    if (!endUser) {
      endUser = await createEndUser({
        productId,
        channelId,
        externalId: payload.externalId,
        isVerified: true,
        displayName: payload.name ?? null,
        email: payload.email ?? null,
        language,
      });
    } else {
      await touchEndUser(idToString(endUser.id), {
        displayName: payload.name ?? null,
        email: payload.email ?? null,
        language,
      });
      endUser = await getEndUserRow(idToString(endUser.id));
    }
  } else if (visitorKey) {
    // Возврат анонимного посетителя: ищем его прошлую сессию в этом канале.
    const prev = await queryOne<RowDataPacket>(
      `SELECT end_user_id FROM sova_end_user_sessions
        WHERE channel_id = ? AND visitor_key = ?
        ORDER BY created_at DESC LIMIT 1`,
      [channelId, visitorKey],
    );
    if (prev) {
      endUser = await getEndUserRow(String(prev.end_user_id));
      if (endUser && idToString(endUser.product_id) !== productId) {
        // Ключ посетителя принадлежит другому продукту — не доверяем ему.
        log.warn({ channelId }, "visitorKey из другого продукта, создаю нового пользователя");
        endUser = null;
        visitorKey = null;
      }
    }
  }

  if (!endUser) {
    endUser = await createEndUser({
      productId,
      channelId,
      isVerified: false,
      language,
    });
  }
  if (!visitorKey) visitorKey = uuid();

  const sessionToken = randomToken(32);
  const sessionId = uuid();
  const expiresAt = new Date(Date.now() + config.auth.clientSessionTtlDays * 24 * 60 * 60_000);

  await execute(
    `INSERT INTO sova_end_user_sessions
       (id, end_user_id, channel_id, token_hash, visitor_key, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      endUser.id,
      channelId,
      sha256Hex(sessionToken),
      visitorKey,
      input.ip?.slice(0, 45) ?? null,
      input.userAgent?.slice(0, 255) ?? null,
      expiresAt,
    ],
  );

  if (language) {
    await touchEndUser(idToString(endUser.id), { language });
  }

  return { sessionToken, sessionId, visitorKey, expiresAt, endUser };
}

/** Проверяет session_token и возвращает контекст клиента. */
export async function resolveClientSession(token: string): Promise<ClientSessionContext> {
  const row = await queryOne<RowDataPacket>(
    `SELECT s.id AS session_id, s.visitor_key, s.end_user_id, s.channel_id
       FROM sova_end_user_sessions s
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
      LIMIT 1`,
    [sha256Hex(token)],
  );
  if (!row) throw errors.unauthorized("Сессия недействительна");

  const endUser = await getEndUserRow(String(row.end_user_id));
  if (!endUser) throw errors.unauthorized("Пользователь не найден");

  const channel = await queryOne<ChannelRow>("SELECT * FROM sova_channels WHERE id = ? LIMIT 1", [
    row.channel_id,
  ]);
  if (!channel || channel.is_active !== 1) throw errors.forbidden("Канал отключён");

  // Пользователь и канал обязаны принадлежать одному продукту.
  if (idToString(channel.product_id) !== idToString(endUser.product_id)) {
    throw errors.forbidden("Сессия не соответствует продукту канала");
  }

  void execute("UPDATE sova_end_user_sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE id = ?", [
    row.session_id,
  ]).catch(() => undefined);

  return {
    sessionId: String(row.session_id),
    endUser,
    channel,
    visitorKey: String(row.visitor_key),
  };
}

/** Выход из аккаунта в SDK: отзывает сессию. Переписка остаётся на сервере. */
export async function revokeClientSession(token: string): Promise<void> {
  await execute(
    "UPDATE sova_end_user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL",
    [sha256Hex(token)],
  );
}
