/**
 * Перевод и отправка ответа оператора.
 *
 * Русский исходник сохраняется неизменным, пользователю уходит только перевод.
 * Если перевод не удался — сообщение помечается «Ошибка», оператор видит это
 * в панели и может повторить. Русский текст иностранному пользователю
 * не отправляется ни при каких обстоятельствах.
 */
import { execute, idToString } from "../infra/db.js";
import { moduleLogger } from "../infra/logger.js";
import {
  requireConversationRow,
} from "../modules/conversations/conversation.service.js";
import { recordEvent } from "../modules/events/event.service.js";
import { getMessageRow, setDeliveryStatus } from "../modules/messages/message.service.js";
import { getProductRow, productRowToDto } from "../modules/products/product.service.js";
import { ensureTranslation, OPERATOR_LANGUAGE } from "../modules/translation/translation.service.js";
import { acquireConversationLock } from "../queue/lock.js";
import type { OutboundJobData } from "../queue/queues.js";
import { deliverMessage, publishConversationUpdate, publishPanelMessageUpdate } from "./delivery.js";
import { withAgentTyping } from '../realtime/activity.js';

const log = moduleLogger("outbound");

export async function processOutboundMessage(data: OutboundJobData): Promise<void> {
  const lock = await acquireConversationLock(data.conversationId, { waitMs: 20_000 });
  if (!lock) throw new Error(`Не удалось получить блокировку диалога ${data.conversationId}`);

  try {
    await withAgentTyping(data.conversationId, `delivery:${data.messageId}`, () => handleOutbound(data));
  } finally {
    await lock.release();
  }
}

async function handleOutbound(data: OutboundJobData): Promise<void> {
  const message = await getMessageRow(data.messageId);
  if (!message) {
    log.warn({ messageId: data.messageId }, "Сообщение оператора не найдено");
    return;
  }
  if (message.delivery_status === "sent" && !data.retry) return;

  const conversation = await requireConversationRow(data.conversationId);
  const productRow = await getProductRow(idToString(conversation.product_id));
  if (!productRow) return;
  const product = productRowToDto(productRow);

  const targetLang = data.targetLang;
  await execute("UPDATE sova_messages SET outbound_lang=? WHERE id=?", [targetLang ?? OPERATOR_LANGUAGE, data.messageId]);

  if (!targetLang || targetLang === OPERATOR_LANGUAGE) {
    // Пользователь пишет по-русски — перевод не нужен.
    await setDeliveryStatus(idToString(message.id), "sent", null);
    await deliverMessage(data.conversationId, idToString(message.id));
    await publishConversationUpdate(data.conversationId);
    return;
  }

  const result = await ensureTranslation({
    messageId: idToString(message.id),
    text: message.original_text,
    sourceLang: OPERATOR_LANGUAGE,
    targetLang,
    productId: product.id,
    conversationId: data.conversationId,
    protectedTerms: [product.name],
    force: data.retry === true,
  });

  if (result.status !== "ok") {
    await setDeliveryStatus(
      idToString(message.id),
      "failed",
      result.error ?? "Перевод не выполнен",
    );
    await publishPanelMessageUpdate(data.conversationId, idToString(message.id));
    await recordEvent(data.conversationId, "operator_message_translation_failed", "system", null, {
      messageId: idToString(message.id),
      error: result.error,
    });
    log.error(
      { messageId: idToString(message.id), targetLang },
      "Перевод ответа оператора не удался, сообщение не отправлено",
    );
    // Бросаем ошибку, чтобы BullMQ повторил попытку заданное число раз.
    throw new Error(`Перевод не выполнен: ${result.error ?? "неизвестная ошибка"}`);
  }

  await setDeliveryStatus(idToString(message.id), "sent", null);
  await deliverMessage(data.conversationId, idToString(message.id));
  await publishPanelMessageUpdate(data.conversationId, idToString(message.id));
  await publishConversationUpdate(data.conversationId);
}
