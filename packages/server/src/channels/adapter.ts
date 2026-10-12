/**
 * Адаптеры каналов.
 *
 * Логика диалогов не знает, откуда пришло сообщение и куда уходит ответ.
 * Чтобы добавить Telegram или вебхуки, достаточно реализовать этот интерфейс
 * и зарегистрировать адаптер — модули conversations/messages/ai не меняются.
 */
import type { ChannelType, ClientMessageDto } from "@sova/shared";
import type { ChannelRow } from "../modules/channels/channel.service.js";

export interface OutboundDelivery {
  channel: ChannelRow;
  conversationId: string;
  /** Сообщение уже приведено к виду, который должен увидеть пользователь. */
  message: ClientMessageDto;
}

export interface StatusDelivery {
  channel: ChannelRow;
  conversationId: string;
  status: string;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  /** Доставка сообщения пользователю. */
  deliver(delivery: OutboundDelivery): Promise<void>;
  /** Доставка изменения состояния диалога (необязательно). */
  deliverStatus?(delivery: StatusDelivery): Promise<void>;
}

const registry = new Map<ChannelType, ChannelAdapter>();

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.type, adapter);
}

export function getChannelAdapter(type: ChannelType): ChannelAdapter | null {
  return registry.get(type) ?? null;
}

export function listChannelAdapters(): ChannelAdapter[] {
  return Array.from(registry.values());
}
