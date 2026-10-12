/**
 * Уведомления оператору: в панель (через шину событий) и в Telegram.
 * Текст уведомления всегда на русском языке.
 */
import { HANDOFF_REASON_RU, PanelEvents, type HandoffReason } from "@sova/shared";
import { config } from "../../config.js";
import { moduleLogger } from "../../infra/logger.js";
import { publishEvent } from "../../realtime/bus.js";
import { getConversationListItem } from "../conversations/conversation.service.js";
import { escapeHtml, sendTelegramMessage } from "./telegram.js";

const log = moduleLogger("notifications");

export async function notifyHandoff(
  conversationId: string,
  reason: HandoffReason,
  summaryRu: string,
): Promise<void> {
  const conversation = await getConversationListItem(conversationId);
  const reasonRu = HANDOFF_REASON_RU[reason] ?? reason;

  await publishEvent({
    target: { scope: "panel" },
    event: PanelEvents.Handoff,
    payload: { conversationId, reason, reasonRu, summaryRu, conversation },
  });

  const link = `${config.panelUrl}/conversations/${conversationId}`;
  const text = [
    "🔔 <b>Новое обращение к оператору</b>",
    `Продукт: ${escapeHtml(conversation.productName)}`,
    `Канал: ${escapeHtml(conversation.channelName)}`,
    `Пользователь: ${escapeHtml(conversation.endUserName)}`,
    `Причина: ${escapeHtml(reasonRu)}`,
    "",
    escapeHtml(summaryRu),
    "",
    link,
  ].join("\n");

  const sent = await sendTelegramMessage(text);
  log.info({ conversationId, reason, telegram: sent }, "Уведомление о передаче оператору");
}

/** Уведомление о новом сообщении в диалоге, который уже ведёт оператор. */
export async function notifyOperatorMessage(
  conversationId: string,
  previewRu: string,
): Promise<void> {
  const conversation = await getConversationListItem(conversationId);
  if (conversation.status !== "operator" && conversation.status !== "waiting_operator") return;

  const text = [
    "💬 <b>Новое сообщение в вашем диалоге</b>",
    `Продукт: ${escapeHtml(conversation.productName)}`,
    `Пользователь: ${escapeHtml(conversation.endUserName)}`,
    "",
    escapeHtml(previewRu.slice(0, 500)),
    "",
    `${config.panelUrl}/conversations/${conversationId}`,
  ].join("\n");

  await sendTelegramMessage(text);
}
