/**
 * Очереди фоновых заданий (BullMQ поверх Redis).
 *
 * Вызовы ИИ и переводы выполняются только здесь: HTTP-запрос клиента
 * завершается сразу после сохранения сообщения в MySQL.
 */
import { Queue, type JobsOptions } from "bullmq";
import { createQueueConnection, key } from "../infra/redis.js";
import { moduleLogger } from "../infra/logger.js";

const log = moduleLogger("queues");

export const QUEUE_INBOUND = "sova-inbound";
export const QUEUE_OUTBOUND = "sova-outbound";

export const QUEUE_PREFIX = key("bull");

/** Обработка входящего сообщения пользователя: язык, перевод, ответ ИИ. */
export interface InboundJobData {
  conversationId: string;
  messageId: string;
  /** Подсказка языка из браузера/устройства. */
  languageHint?: string | null;
}

/** Перевод и отправка ответа оператора пользователю. */
export interface OutboundJobData {
  conversationId: string;
  messageId: string;
  targetLang: string;
  /** Повтор по кнопке «Повторить» в панели. */
  retry?: boolean;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

let inboundQueue: Queue<InboundJobData> | null = null;
let outboundQueue: Queue<OutboundJobData> | null = null;

export function getInboundQueue(): Queue<InboundJobData> {
  if (!inboundQueue) {
    inboundQueue = new Queue<InboundJobData>(QUEUE_INBOUND, {
      connection: createQueueConnection(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return inboundQueue;
}

export function getOutboundQueue(): Queue<OutboundJobData> {
  if (!outboundQueue) {
    outboundQueue = new Queue<OutboundJobData>(QUEUE_OUTBOUND, {
      connection: createQueueConnection(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return outboundQueue;
}

/**
 * Ставит в очередь обработку входящего сообщения.
 * jobId делает постановку идемпотентной: повторная попытка не создаст дубль.
 */
export async function enqueueInbound(data: InboundJobData): Promise<void> {
  try {
    await getInboundQueue().add("inbound", data, { jobId: `in-${data.messageId}` });
  } catch (err) {
    // Очередь недоступна — сообщение уже сохранено, ответственность за
    // повторную обработку берёт на себя фоновая сверка (reconcile).
    log.error({ err: String(err), messageId: data.messageId }, "Не удалось поставить задание inbound");
  }
}

export async function enqueueOutbound(data: OutboundJobData): Promise<void> {
  try {
    const suffix = data.retry ? `-r${Date.now()}` : "";
    await getOutboundQueue().add("outbound", data, {
      jobId: `out-${data.messageId}-${data.targetLang}${suffix}`,
    });
  } catch (err) {
    log.error({ err: String(err), messageId: data.messageId }, "Не удалось поставить задание outbound");
  }
}

export async function closeQueues(): Promise<void> {
  await inboundQueue?.close().catch(() => undefined);
  await outboundQueue?.close().catch(() => undefined);
  inboundQueue = null;
  outboundQueue = null;
}
