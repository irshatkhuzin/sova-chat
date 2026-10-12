/**
 * Шина событий между процессами (API и воркер) через Redis Pub/Sub.
 *
 * Воркер не держит Socket.IO-соединений: он публикует событие в шину, а все
 * процессы API рассылают его своим подключённым клиентам. Это позволяет
 * запускать несколько экземпляров API без потери событий.
 */
import { createSubscriberConnection, getRedis, key } from "../infra/redis.js";
import { moduleLogger } from "../infra/logger.js";

const log = moduleLogger("bus");

const CHANNEL = key("events");

export type BusTarget =
  | { scope: "client"; conversationId: string }
  | { scope: "panel" };

export interface BusEvent {
  target: BusTarget;
  event: string;
  payload: unknown;
}

export async function publishEvent(event: BusEvent): Promise<void> {
  try {
    await getRedis().publish(CHANNEL, JSON.stringify(event));
  } catch (err) {
    // Потеря realtime-события не должна ломать основной сценарий:
    // сообщение уже сохранено в MySQL и будет получено клиентом при синхронизации.
    log.error({ err, event: event.event }, "Не удалось опубликовать событие в шину");
  }
}

export function subscribeEvents(handler: (event: BusEvent) => void): () => Promise<void> {
  const sub = createSubscriberConnection();
  void sub.subscribe(CHANNEL, (err) => {
    if (err) log.error({ err }, "Не удалось подписаться на шину событий");
    else log.info({ channel: CHANNEL }, "Подписка на шину событий активна");
  });

  sub.on("message", (_channel: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw) as BusEvent;
      handler(parsed);
    } catch (err) {
      log.error({ err }, "Некорректное событие в шине");
    }
  });

  return async () => {
    await sub.quit().catch(() => undefined);
  };
}
