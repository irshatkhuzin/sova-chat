/**
 * Блокировка на уровне диалога.
 * Гарантирует, что для одного диалога одновременно выполняется только одно
 * фоновое задание — иначе порядок сообщений может нарушиться.
 */
import { getRedis, key } from "../infra/redis.js";
import { uuid } from "../infra/crypto.js";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface ConversationLock {
  release: () => Promise<void>;
}

export async function acquireConversationLock(
  conversationId: string,
  options: { ttlMs?: number; waitMs?: number } = {},
): Promise<ConversationLock | null> {
  const redis = getRedis();
  const lockKey = key("lock", "conv", conversationId);
  const token = uuid();
  const ttlMs = options.ttlMs ?? 120_000;
  const waitMs = options.waitMs ?? 15_000;
  const deadline = Date.now() + waitMs;

  for (;;) {
    const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (result === "OK") {
      return {
        release: async () => {
          try {
            await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
          } catch {
            // Блокировка истечёт сама.
          }
        },
      };
    }
    if (Date.now() >= deadline) return null;
    await sleep(150 + Math.floor(Math.random() * 150));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
