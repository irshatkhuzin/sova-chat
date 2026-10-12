/**
 * Доставка сообщений: пользователю (через адаптер канала) и в панель (через шину).
 * Единая точка, чтобы сообщение нигде не «терялось» и всегда уходило в обе стороны.
 */
import { PanelEvents } from "@sova/shared";
import { idToString, queryOne } from "../infra/db.js";
import { moduleLogger } from "../infra/logger.js";
import { publishEvent } from "../realtime/bus.js";
import { getChannelAdapter } from "../channels/adapter.js";
import type { ChannelRow } from "../modules/channels/channel.service.js";
import {
  getConversationListItem,
  requireConversationRow,
  type ConversationRow,
} from "../modules/conversations/conversation.service.js";
import { buildMessageDtos } from "../modules/messages/message.service.js";

const log = moduleLogger("delivery");

export async function getChannelRowForConversation(
  conversation: ConversationRow,
): Promise<ChannelRow> {
  const channel = await queryOne<ChannelRow>("SELECT * FROM sova_channels WHERE id = ? LIMIT 1", [
    conversation.channel_id,
  ]);
  if (!channel) throw new Error(`Канал ${idToString(conversation.channel_id)} не найден`);
  return channel;
}

/**
 * Отправляет сообщение пользователю и оператору.
 * Если текст для пользователя ещё не готов (например, перевод не выполнен),
 * пользователю не уходит ничего — в панели сообщение при этом видно.
 */
export async function deliverMessage(
  conversationId: string,
  messageId: string,
  options: { toClient?: boolean; toPanel?: boolean } = {},
): Promise<void> {
  const toClient = options.toClient ?? true;
  const toPanel = options.toPanel ?? true;

  const conversation = await requireConversationRow(conversationId);
  const dtos = await buildMessageDtos(messageId, conversation.language);

  if (toPanel) {
    const listItem = await getConversationListItem(conversationId);
    await publishEvent({
      target: { scope: "panel" },
      event: PanelEvents.Message,
      payload: { conversationId, message: dtos.panel, conversation: listItem },
    });
  }

  if (toClient && dtos.client) {
    const channel = await getChannelRowForConversation(conversation);
    const adapter = getChannelAdapter(channel.type);
    if (!adapter) {
      log.error({ type: channel.type }, "Адаптер канала не зарегистрирован");
      return;
    }
    await adapter.deliver({ channel, conversationId, message: dtos.client });
  }
}

/** Обновление карточки сообщения в панели (перевод готов, статус изменился). */
export async function publishPanelMessageUpdate(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const conversation = await requireConversationRow(conversationId);
  const dtos = await buildMessageDtos(messageId, conversation.language);
  await publishEvent({
    target: { scope: "panel" },
    event: PanelEvents.MessageUpdated,
    payload: { conversationId, message: dtos.panel },
  });
}

/** Обновление карточки диалога в списке панели. */
export async function publishConversationUpdate(conversationId: string): Promise<void> {
  const conversation = await getConversationListItem(conversationId);
  await publishEvent({
    target: { scope: "panel" },
    event: PanelEvents.ConversationUpdated,
    payload: { conversation },
  });
}

/** Сообщение клиенту об изменении состояния диалога. */
export async function publishClientStatus(conversationId: string): Promise<void> {
  const conversation = await requireConversationRow(conversationId);
  const channel = await getChannelRowForConversation(conversation);
  const adapter = getChannelAdapter(channel.type);
  if (adapter?.deliverStatus) {
    await adapter.deliverStatus({ channel, conversationId, status: conversation.status });
  }
}
