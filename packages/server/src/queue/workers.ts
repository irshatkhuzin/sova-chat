import { processLearningJob } from "../modules/knowledge/learning.service.js";
/**
 * Фоновые обработчики: ответы ИИ, переводы, сверка «повисших» сообщений.
 *
 * Вынесено отдельно, чтобы один и тот же код запускался:
 *  • отдельным процессом (worker.ts) — когда памяти достаточно;
 *  • внутри процесса API (SOVA_ROLE=all) — когда сервер небольшой
 *    и лишний процесс Node стоит дороже, чем изоляция.
 */
import { Worker, type Job } from "bullmq";
import type { RowDataPacket } from "mysql2/promise";
import { idToString, query, execute } from "../infra/db.js";
import { moduleLogger } from "../infra/logger.js";
import { createQueueConnection } from "../infra/redis.js";
import { processInboundMessage } from "../pipeline/inbound.processor.js";
import { processOutboundMessage } from "../pipeline/outbound.processor.js";
import { OPERATOR_LANGUAGE } from "../modules/translation/translation.service.js";
import {
  QUEUE_INBOUND,
  QUEUE_OUTBOUND,
  QUEUE_PREFIX,
  enqueueInbound,
  enqueueOutbound,
  type InboundJobData,
  type OutboundJobData,
} from "./queues.js";

const log = moduleLogger("workers");

const RECONCILE_INTERVAL_MS = 60_000;

export interface WorkerHandles {
  stop: () => Promise<void>;
}

export interface StartWorkersOptions {
  /** Сколько заданий обрабатывать одновременно. На 2 ГБ памяти разумно 2. */
  concurrency?: number;
  /** Ограничение частоты обращений к провайдеру ИИ. */
  aiJobsPerMinute?: number;
  translationJobsPerMinute?: number;
}

export function startWorkers(options: StartWorkersOptions = {}): WorkerHandles {
  const concurrency = options.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 2);
  const aiPerMinute = options.aiJobsPerMinute ?? 30;
  const translationPerMinute = options.translationJobsPerMinute ?? 60;

  const inboundWorker = new Worker<InboundJobData>(
    QUEUE_INBOUND,
    async (job: Job<InboundJobData>) => {
      await processInboundMessage(job.data);
    },
    {
      connection: createQueueConnection(),
      prefix: QUEUE_PREFIX,
      concurrency,
      limiter: { max: aiPerMinute, duration: 60_000 },
    },
  );

  const outboundWorker = new Worker<OutboundJobData>(
    QUEUE_OUTBOUND,
    async (job: Job<OutboundJobData>) => {
      await processOutboundMessage(job.data);
    },
    {
      connection: createQueueConnection(),
      prefix: QUEUE_PREFIX,
      concurrency,
      limiter: { max: translationPerMinute, duration: 60_000 },
    },
  );

  for (const [name, worker] of [
    ["inbound", inboundWorker],
    ["outbound", outboundWorker],
  ] as const) {
    worker.on("failed", (job, err) => {
      log.error(
        { queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
        "Задание завершилось ошибкой",
      );
    });
    worker.on("completed", (job) => {
      log.debug({ queue: name, jobId: job.id }, "Задание выполнено");
    });
  }

  let learningRun: Promise<void> | null = null;
  const learn = () => {
    if (learningRun) return;
    learningRun = (async () => {
      await execute("UPDATE sova_learning_jobs SET status='failed' WHERE status='processing' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)");
      const jobs = await query<RowDataPacket>("SELECT id FROM sova_learning_jobs WHERE status IN ('pending','failed') AND attempts<3 ORDER BY id LIMIT 3");
      for(const job of jobs) await processLearningJob(String(job.id));
    })().catch(err => log.warn({ err: String(err) }, "Анализ закрытых диалогов не выполнен")).finally(() => {learningRun=null;});
  };
  const learningTimer = setInterval(learn, 15000);
  learn();
  const reconcileTimer = setInterval(() => {
    void reconcile();
  }, RECONCILE_INTERVAL_MS);

  log.info({ concurrency }, "Фоновые обработчики запущены");

  return {
    stop: async () => {
      clearInterval(reconcileTimer);
      clearInterval(learningTimer);
      await learningRun;
      await inboundWorker.close().catch(() => undefined);
      await outboundWorker.close().catch(() => undefined);
    },
  };
}

/**
 * Сверка: если Redis был недоступен в момент приёма сообщения, задание могло
 * не попасть в очередь. Раз в минуту находим «повисшие» сообщения и ставим их заново.
 */
export async function reconcile(): Promise<void> {
  try {
    // Recover filtering/publication even for conversations already owned by an operator.
    const unscreened = await query<RowDataPacket>(`SELECT m.id,m.conversation_id
      FROM sova_screening s JOIN sova_messages m ON m.id=s.message_id
      WHERE (s.verdict='pending' OR (s.verdict='allowed' AND s.published=0))
        AND m.created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE) LIMIT 50`);
    for (const row of unscreened) await enqueueInbound({conversationId:idToString(row.conversation_id),messageId:idToString(row.id)});
    // 1. Сообщения оператора, застрявшие в статусе «отправляется».
    const pending = await query<RowDataPacket>(
      `SELECT m.id, m.conversation_id, c.language
         FROM sova_messages m
         JOIN sova_conversations c ON c.id = m.conversation_id
        WHERE m.author_type = 'operator'
          AND m.delivery_status = 'pending'
          AND m.created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)
        LIMIT 50`,
    );
    for (const row of pending) {
      await enqueueOutbound({
        conversationId: idToString(row.conversation_id),
        messageId: idToString(row.id),
        targetLang: (row.language as string | null) ?? OPERATOR_LANGUAGE,
      });
    }

    // 2. Сообщения пользователя в диалогах ИИ, на которые никто не ответил.
    const unanswered = await query<RowDataPacket>(
      `SELECT m.id, m.conversation_id
         FROM sova_messages m
         JOIN sova_conversations c ON c.id = m.conversation_id
        WHERE m.author_type = 'user'
          AND c.status = 'ai' AND NOT EXISTS (SELECT 1 FROM sova_screening s WHERE s.message_id=m.id AND s.verdict='rejected')
          AND m.seq = c.last_seq
          AND m.created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 MINUTE)
        LIMIT 50`,
    );
    for (const row of unanswered) {
      await enqueueInbound({
        conversationId: idToString(row.conversation_id),
        messageId: idToString(row.id),
      });
    }

    if (pending.length > 0 || unanswered.length > 0) {
      log.info(
        { pending: pending.length, unanswered: unanswered.length },
        "Сверка: задания поставлены заново",
      );
    }
  } catch (err) {
    log.warn({ err: String(err) }, "Сверка не выполнена");
  }
}
