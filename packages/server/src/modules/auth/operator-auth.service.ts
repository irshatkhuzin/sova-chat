/**
 * Вход операторов: проверка пароля, выпуск access- и refresh-токенов,
 * ротация refresh-токена, выход.
 *
 * access-токен — короткоживущий JWT в httpOnly-cookie.
 * refresh-токен — случайная строка, в базе хранится только её SHA-256.
 */
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2/promise";
import type { OperatorDto } from "@sova/shared";
import { config } from "../../config.js";
import { execute, query, queryOne, dateToIso, idToString } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { randomToken, sha256Hex, uuid } from "../../infra/crypto.js";
import { verifyPassword } from "./password.js";

interface OperatorRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "operator";
  is_active: number;
  telegram_user_id: string | null;
  created_at: Date;
}

export interface AccessTokenPayload {
  sub: string;
  role: "admin" | "operator";
  sid: string;
}

export interface LoginResult {
  operator: OperatorDto;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

function toDto(row: OperatorRow): OperatorDto {
  return {
    id: idToString(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    telegramUserId: row.telegram_user_id,
    createdAt: dateToIso(row.created_at) ?? new Date().toISOString(),
  };
}

function signAccessToken(operator: OperatorRow, sessionId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + config.auth.accessTokenTtlMin * 60_000);
  const payload: AccessTokenPayload = {
    sub: idToString(operator.id),
    role: operator.role,
    sid: sessionId,
  };
  const token = jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: `${config.auth.accessTokenTtlMin}m`,
    issuer: "sova",
    audience: "sova-panel",
  });
  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret, {
      issuer: "sova",
      audience: "sova-panel",
    });
    if (typeof decoded === "string") throw new Error("bad payload");
    return decoded as AccessTokenPayload;
  } catch {
    throw errors.unauthorized("Сессия истекла, войдите заново");
  }
}

export async function findOperatorById(id: string): Promise<OperatorDto | null> {
  const row = await queryOne<OperatorRow>("SELECT * FROM sova_operators WHERE id = ? LIMIT 1", [id]);
  return row ? toDto(row) : null;
}

export async function listOperators(): Promise<OperatorDto[]> {
  const rows = await query<OperatorRow>("SELECT * FROM sova_operators ORDER BY created_at ASC");
  return rows.map(toDto);
}

/** Проверяет, что сессия оператора не отозвана и не истекла. */
export async function assertSessionActive(sessionId: string): Promise<void> {
  const row = await queryOne<RowDataPacket>(
    "SELECT id FROM sova_operator_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3) LIMIT 1",
    [sessionId],
  );
  if (!row) throw errors.unauthorized("Сессия завершена, войдите заново");
}

export async function login(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<LoginResult> {
  const row = await queryOne<OperatorRow>(
    "SELECT * FROM sova_operators WHERE email = ? LIMIT 1",
    [email.trim().toLowerCase()],
  );

  // Одинаковая ошибка и одинаковое время для «нет пользователя» и «неверный пароль».
  const passwordOk = row ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !passwordOk) {
    throw errors.unauthorized("Неверный email или пароль");
  }
  if (row.is_active !== 1) {
    throw errors.forbidden("Учётная запись отключена");
  }

  const sessionId = uuid();
  const refreshToken = randomToken(32);
  const refreshExpiresAt = new Date(
    Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60_000,
  );

  await execute(
    `INSERT INTO sova_operator_sessions (id, operator_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      row.id,
      sha256Hex(refreshToken),
      meta.userAgent?.slice(0, 255) ?? null,
      meta.ip?.slice(0, 45) ?? null,
      refreshExpiresAt,
    ],
  );

  await execute("UPDATE sova_operators SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?", [row.id]);

  const access = signAccessToken(row, sessionId);

  return {
    operator: toDto(row),
    accessToken: access.token,
    refreshToken,
    accessTokenExpiresAt: access.expiresAt,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

/** Ротация: старый refresh-токен помечается использованным, выдаётся новый. */
export async function refresh(
  refreshToken: string,
  meta: { ip?: string; userAgent?: string },
): Promise<LoginResult> {
  const hash = sha256Hex(refreshToken);
  const session = await queryOne<RowDataPacket>(
    `SELECT s.id, s.operator_id, s.expires_at, s.revoked_at
       FROM sova_operator_sessions s
      WHERE s.refresh_token_hash = ? LIMIT 1`,
    [hash],
  );

  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    throw errors.unauthorized("Сессия истекла, войдите заново");
  }

  const operator = await queryOne<OperatorRow>("SELECT * FROM sova_operators WHERE id = ? LIMIT 1", [
    session.operator_id,
  ]);
  if (!operator || operator.is_active !== 1) {
    throw errors.unauthorized("Учётная запись недоступна");
  }

  const newSessionId = uuid();
  const newRefresh = randomToken(32);
  const refreshExpiresAt = new Date(
    Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60_000,
  );

  await execute("UPDATE sova_operator_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?", [
    session.id,
  ]);
  await execute(
    `INSERT INTO sova_operator_sessions (id, operator_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      newSessionId,
      operator.id,
      sha256Hex(newRefresh),
      meta.userAgent?.slice(0, 255) ?? null,
      meta.ip?.slice(0, 45) ?? null,
      refreshExpiresAt,
    ],
  );

  const access = signAccessToken(operator, newSessionId);
  return {
    operator: toDto(operator),
    accessToken: access.token,
    refreshToken: newRefresh,
    accessTokenExpiresAt: access.expiresAt,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await execute(
    "UPDATE sova_operator_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE refresh_token_hash = ? AND revoked_at IS NULL",
    [sha256Hex(refreshToken)],
  );
}

export async function cleanupExpiredSessions(): Promise<number> {
  const res = await execute(
    "DELETE FROM sova_operator_sessions WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)",
  );
  return res.affectedRows ?? 0;
}
