/**
 * Регистрация адаптеров каналов.
 *
 * Сейчас реализованы web и android: оба доставляют сообщения через постоянное
 * соединение (Socket.IO) и REST-синхронизацию, поэтому используют общий адаптер.
 * Telegram и вебхуки — заготовки со всеми нужными интерфейсами; их реализация
 * не потребует изменений в логике диалогов.
 */
import { ClientEvents } from "@sova/shared";
import { publishEvent } from "../realtime/bus.js";
import { moduleLogger } from "../infra/logger.js";
import {
  registerChannelAdapter,
  type ChannelAdapter,
  type OutboundDelivery,
  type StatusDelivery,
} from "./adapter.js";

const log = moduleLogger("channels");

/** Доставка через постоянное соединение: виджет на сайте и Android SDK. */
class RealtimeAdapter implements ChannelAdapter {
  constructor(readonly type: "web" | "android") {}

  async deliver(delivery: OutboundDelivery): Promise<void> {
    await publishEvent({
      target: { scope: "client", conversationId: delivery.conversationId },
      event: ClientEvents.Message,
      payload: { conversationId: delivery.conversationId, message: delivery.message },
    });
  }

  async deliverStatus(delivery: StatusDelivery): Promise<void> {
    await publishEvent({
      target: { scope: "client", conversationId: delivery.conversationId },
      event: ClientEvents.ConversationStatus,
      payload: { conversationId: delivery.conversationId, status: delivery.status },
    });
  }
}

/**
 * Заготовка Telegram-канала. Следующий этап: бот принимает сообщения,
 * создаёт end_user по chat_id и отправляет ответы через Bot API.
 */
class TelegramAdapter implements ChannelAdapter {
  readonly type = "telegram" as const;

  async deliver(delivery: OutboundDelivery): Promise<void> {
    log.warn(
      { conversationId: delivery.conversationId },
      "Telegram-канал ещё не реализован: сообщение не отправлено пользователю",
    );
  }
}

/** Заготовка вебхук-канала: POST на адрес из настроек канала с подписью HMAC. */
class WebhookAdapter implements ChannelAdapter {
  readonly type = "webhook" as const;

  async deliver(delivery: OutboundDelivery): Promise<void> {
    log.warn(
      { conversationId: delivery.conversationId },
      "Вебхук-канал ещё не реализован: сообщение не отправлено",
    );
  }
}

let registered = false;

export function registerChannels(): void {
  if (registered) return;
  registerChannelAdapter(new RealtimeAdapter("web"));
  registerChannelAdapter(new RealtimeAdapter("android"));
  registerChannelAdapter(new TelegramAdapter());
  registerChannelAdapter(new WebhookAdapter());
  registered = true;
}
