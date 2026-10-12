import { isAgentReady } from "./modules/ai/settings.service.js";
/**
 * Процесс API: HTTP + Socket.IO.
 * Фоновые задания выполняет отдельный процесс (worker.ts).
 */
import http from "node:http";
import { config } from "./config.js";
import { logger } from "./infra/logger.js";
import { closePool, pingDb } from "./infra/db.js";
import { closeRedis, pingRedis } from "./infra/redis.js";
import { registerChannels } from "./channels/index.js";
import { createApp } from "./http/app.js";
import { closeSocketServer, initSocketServer } from "./realtime/io.js";
import { closeQueues } from "./queue/queues.js";
import { startWorkers, type WorkerHandles } from "./queue/workers.js";

async function main(): Promise<void> {
  registerChannels();

  const dbOk = await pingDb();
  if (!dbOk) {
    logger.error("MySQL недоступен — запуск прерван");
    process.exit(1);
  }
  const redisOk = await pingRedis();
  if (!redisOk) {
    logger.warn("Redis недоступен: очереди и лимиты работать не будут до восстановления");
  }

  if (!(await isAgentReady("support"))) {
    logger.warn(
      "Основной ИИ не настроен в разделе AI-агенты. Сообщения сохраняются и передаются оператору, ответы ИИ не генерируются.",
    );
  }

  const app = createApp();
  const server = http.createServer(app);
  initSocketServer(server);

  /**
   * Объединённый режим для небольших серверов: фоновые обработчики живут
   * в этом же процессе. Экономит ~100 МБ памяти по сравнению с отдельным
   * процессом воркера. Включается переменной SOVA_ROLE=all.
   */
  let workers: WorkerHandles | null = null;
  if (process.env.SOVA_ROLE === "all") {
    if (redisOk) {
      workers = startWorkers();
      logger.info("Фоновые обработчики запущены внутри процесса API (SOVA_ROLE=all)");
    } else {
      logger.error("SOVA_ROLE=all, но Redis недоступен: фоновые обработчики не запущены");
    }
  }

  server.listen(config.port, config.host, () => {
    logger.info(
      { port: config.port, publicUrl: config.publicUrl, env: config.env, role: process.env.SOVA_ROLE ?? "api" },
      "Sova API запущен",
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Остановка API");
    server.close();
    if (workers) await workers.stop();
    await closeSocketServer();
    await closeQueues();
    await closePool();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "Необработанное отклонение промиса");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err: err.message }, "Необработанное исключение");
  });
}

void main();
