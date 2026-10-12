import { isAgentReady } from "./modules/ai/settings.service.js";
/**
 * Процесс фоновых заданий: ответы ИИ, переводы, сверка.
 *
 * Отдельный процесс нужен, чтобы медленные вызовы модели не влияли на задержку
 * HTTP-запросов. На сервере с малым объёмом памяти те же обработчики можно
 * запустить внутри процесса API: SOVA_ROLE=all (см. docs/VPS-COEXISTENCE.md).
 */
import { config } from "./config.js";
import { logger } from "./infra/logger.js";
import { closePool, pingDb } from "./infra/db.js";
import { closeRedis, pingRedis } from "./infra/redis.js";
import { registerChannels } from "./channels/index.js";
import { closeQueues } from "./queue/queues.js";
import { startWorkers } from "./queue/workers.js";

const log = logger.child({ module: "worker" });

async function main(): Promise<void> {
  registerChannels();

  if (!(await pingDb())) {
    log.error("MySQL недоступен — воркер не запущен");
    process.exit(1);
  }
  if (!(await pingRedis())) {
    log.error("Redis недоступен — воркер не запущен");
    process.exit(1);
  }
  if (!(await isAgentReady("support"))) {
    log.warn("ИИ отключён (нет ключа). Входящие сообщения будут передаваться оператору.");
  }

  const workers = startWorkers();
  log.info("Sova worker запущен");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "Остановка воркера");
    await workers.stop();
    await closeQueues();
    await closePool();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    log.error({ reason: String(reason) }, "Необработанное отклонение промиса");
  });
}

void main();
