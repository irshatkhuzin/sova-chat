/**
 * Пул подключений MySQL и небольшие помощники.
 * Весь SQL пишется параметризованно — конкатенация значений запрещена.
 */
import mysql from "mysql2";
import type { ExecuteValues } from "mysql2";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { config } from "../config.js";
import { moduleLogger } from "./logger.js";

const log = moduleLogger("db");

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const corePool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: "utf8mb4_unicode_ci",
      timezone: "Z",
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      namedPlaceholders: false,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });
    // Driver timezone controls Date conversion, not MySQL CURRENT_TIMESTAMP.
    // Apply UTC only to our connections; never change the shared server setting.
    corePool.on("connection", (connection) => {
      connection.query("SET time_zone = '+00:00'", (err: Error | null) => {
        if (err) {
          log.error({ err }, "Не удалось установить UTC для подключения MySQL");
          connection.destroy();
        }
      });
    });
    pool = corePool.promise();
    log.info({ host: config.db.host, database: config.db.database }, "Пул MySQL создан");
  }
  return pool;
}

export type Row = RowDataPacket;

/** SELECT, возвращающий массив строк. */
export async function query<T extends RowDataPacket>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const [rows] = await getPool().query<T[]>(sql, params as unknown[]);
  return rows;
}

/** SELECT, возвращающий одну строку или null. */
export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE. */
export async function execute(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params as ExecuteValues);
  return result;
}

/** Транзакция с автоматическим rollback при ошибке. */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      log.error({ err: rollbackErr }, "Ошибка отката транзакции");
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    log.info("Пул MySQL закрыт");
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.ping();
      return true;
    } finally {
      conn.release();
    }
  } catch (err) {
    log.error({ err }, "MySQL недоступен");
    return false;
  }
}

/** MySQL с supportBigNumbers отдаёт BIGINT строками. Приводим к строке единообразно. */
export function idToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Преобразует Date из mysql2 в ISO-строку (или null). */
export function dateToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

/** Безопасный разбор JSON-поля из TEXT-колонки. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
