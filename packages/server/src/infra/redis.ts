/**
 * Подключения Redis.
 * Отдельные соединения: общее (команды), для BullMQ, для подписки на шину событий.
 */
import IORedis from "ioredis";
import type { RedisOptions } from "ioredis";
import { config } from "../config.js";
import { moduleLogger } from "./logger.js";

const log = moduleLogger("redis");

function baseOptions(): RedisOptions {
  const opts: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
    lazyConnect: false,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 500, 10_000),
  };
  if (config.redis.username) opts.username = config.redis.username;
  if (config.redis.password) opts.password = config.redis.password;
  if (config.redis.tls) opts.tls = {};
  return opts;
}

let client: IORedis | null = null;
const ownedConnections = new Set<IORedis>();

/** Общее соединение для обычных команд. */
export function getRedis(): IORedis {
  if (!client) {
    client = new IORedis(baseOptions());
    client.on("error", (err: Error) => log.error({ err }, "Ошибка Redis"));
    client.on("ready", () => log.info("Redis готов"));
  }
  return client;
}

/**
 * Соединение для BullMQ. Требование библиотеки: maxRetriesPerRequest = null.
 * Каждый вызов создаёт новое соединение — очередь и воркер не должны его делить.
 */
export function createQueueConnection(): IORedis {
  const conn = new IORedis({ ...baseOptions(), maxRetriesPerRequest: null });
  ownedConnections.add(conn);
  conn.once("end", () => ownedConnections.delete(conn));
  conn.on("error", (err: Error) => log.error({ err }, "Ошибка Redis (очереди)"));
  return conn;
}

/** Отдельное соединение для подписки (в режиме subscribe обычные команды запрещены). */
export function createSubscriberConnection(): IORedis {
  const conn = new IORedis(baseOptions());
  conn.on("error", (err: Error) => log.error({ err }, "Ошибка Redis (подписка)"));
  return conn;
}

export function key(...parts: Array<string | number>): string {
  return [config.redis.prefix, ...parts].join(":");
}

export async function pingRedis(): Promise<boolean> {
  try {
    const res = await getRedis().ping();
    return res === "PONG";
  } catch (err) {
    log.error({ err }, "Redis недоступен");
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.all([...ownedConnections].map(conn => conn.quit().catch(() => conn.disconnect())));
  ownedConnections.clear();
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
