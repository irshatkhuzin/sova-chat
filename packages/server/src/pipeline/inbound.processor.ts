import { localizeChannel, getWidgetLanguage, localizationSource } from "../modules/channels/localization.service.js";
import { screenMessage, publishApprovedMessage } from "../modules/ai/screening.service.js";
import { isAgentReady, resolveAgent } from "../modules/ai/settings.service.js";
/**
 * Обработка входящего сообщения пользователя.
 *
 * Шаги: определение языка → перевод на русский для панели → (если диалогом
 * занимается ИИ) ответ ИИ или передача оператору.
 *
 * Перед отправкой ответа ИИ состояние диалога проверяется повторно в той же
 * транзакции, что и запись сообщения: если оператор успел забрать диалог,
 * ответ не отправляется и остаётся только в журнале.
 */
import { DEFAULT_WIDGET_SETTINGS, type HandoffReason, type WidgetSettings } from "@sova/shared";
import { config } from "../config.js";
import { idToString, parseJson, execute } from "../infra/db.js";
import { moduleLogger } from "../infra/logger.js";
import { runAiTurn } from "../modules/ai/ai.service.js";
import type { AiHistoryItem } from "../modules/ai/provider.js";
import {
  getConversationRow,
  handoffToOperator,
  incrementClarifyRounds,
  requireConversationRow,
} from "../modules/conversations/conversation.service.js";
import { recordEvent } from "../modules/events/event.service.js";
import {
  appendMessage,
  buildAiHistory,
  getMessageRow,
  setMessageLanguage,
} from "../modules/messages/message.service.js";
import { notifyHandoff, notifyOperatorMessage } from "../modules/notifications/notification.service.js";
import { getProductRow, productRowToDto } from "../modules/products/product.service.js";
import {
  ensureTranslation,
  getStoredTranslation,
  OPERATOR_LANGUAGE,
} from "../modules/translation/translation.service.js";
import { acquireConversationLock } from "../queue/lock.js";
import type { InboundJobData } from "../queue/queues.js";
import { deliverMessage, getChannelRowForConversation, publishConversationUpdate, publishPanelMessageUpdate, publishClientStatus } from "./delivery.js";

const log = moduleLogger("inbound");
import { resolveInboundLanguage } from "../modules/translation/conversation-language.js";
import { isUserBlocked } from '../modules/users/moderation.service.js';
import { withAgentTyping } from '../realtime/activity.js';

export async function processInboundMessage(data: InboundJobData): Promise<void> {
  const lock = await acquireConversationLock(data.conversationId, { waitMs: 20_000 });
  if (!lock) {
    // Другой обработчик занят этим диалогом — пусть BullMQ повторит позже.
    throw new Error(`Не удалось получить блокировку диалога ${data.conversationId}`);
  }

  try {
    await handleInbound(data);
  } finally {
    await lock.release();
  }
}

async function handleInbound(data: InboundJobData): Promise<void> {
  const message = await getMessageRow(data.messageId);
  if (!message) {
    log.warn({ messageId: data.messageId }, "Сообщение не найдено, задание пропущено");
    return;
  }
  if (message.author_type !== "user") return;

  const conversation = await requireConversationRow(data.conversationId);
  if(await isUserBlocked(idToString(conversation.end_user_id)))return;
  const productRow = await getProductRow(idToString(conversation.product_id));
  if (!productRow) {
    log.error({ conversationId: data.conversationId }, "Продукт диалога не найден");
    return;
  }
  const product = productRowToDto(productRow);
  if (!(await screenMessage(message, product.id))) return;
  if(await isUserBlocked(idToString(conversation.end_user_id)))return;
  await publishApprovedMessage(message);
  await deliverMessage(data.conversationId, data.messageId, { toClient: false });
  await publishConversationUpdate(data.conversationId);

  // ── 1. Язык сообщения ─────────────────────────────────────────────────────
  let messageLang = message.original_lang;
  if (!messageLang) {
    messageLang = await resolveInboundLanguage(conversation, message, product.id, product.defaultLanguage, data.languageHint);
    await setMessageLanguage(idToString(message.id), messageLang);
    log.debug(
      { conversationId: data.conversationId, lang: messageLang },
      "Язык сообщения определён",
    );
  }

  const conversationAfterLang = await requireConversationRow(data.conversationId);
  const conversationLanguage = conversationAfterLang.language ?? messageLang;

  // ── 2. Перевод на русский для панели ──────────────────────────────────────
  if (messageLang !== OPERATOR_LANGUAGE) {
    const result = await ensureTranslation({
      messageId: idToString(message.id),
      text: message.original_text,
      sourceLang: messageLang,
      targetLang: OPERATOR_LANGUAGE,
      productId: product.id,
      conversationId: data.conversationId,
      protectedTerms: [product.name],
    });
    if (result.status === "ok" || result.status === "failed") {
      await publishPanelMessageUpdate(data.conversationId, idToString(message.id));
    }
  }

  // ── 3. Диалогом занимается оператор — ИИ молчит ───────────────────────────
  if (conversationAfterLang.status !== "ai") {
    const stored = await getStoredTranslation(idToString(message.id), OPERATOR_LANGUAGE);
    await notifyOperatorMessage(
      data.conversationId,
      stored?.text ?? message.original_text,
    );
    return;
  }

  // ── 4. Ответ ИИ ───────────────────────────────────────────────────────────
  if(await isUserBlocked(idToString(conversation.end_user_id)))return;
  await withAgentTyping(data.conversationId, `ai:${data.messageId}`, async () => {
  const history = await buildHistory(data.conversationId, conversationLanguage);
  const ruTranslation = await getStoredTranslation(idToString(message.id), OPERATOR_LANGUAGE);
  const searchText = ruTranslation?.text ?? message.original_text;

  const expectedVersion = Number(conversationAfterLang.state_version);

  const turn = await runAiTurn({
    messageId:data.messageId,
    product: productRow,
    conversationId: data.conversationId,
    language: conversationLanguage,
    history,
    searchText,
    clarifyRounds: Number(conversationAfterLang.ai_clarify_rounds),
  });

  if (turn.kind === "handoff") {
    await performHandoff({
      conversationId: data.conversationId,
      expectedVersion,
      reason: turn.reason,
      summaryRu: turn.summaryRu,
      language: conversationLanguage,
      productId: product.id,
      productName: product.name,
      noticeText: null,
    });
    return;
  }

  const decision = turn.decision;

  if (decision.action === "handoff") {
    await performHandoff({
      conversationId: data.conversationId,
      expectedVersion,
      reason: decision.handoffReason ?? "no_answer_in_kb",
      summaryRu: decision.summaryRu,
      language: conversationLanguage,
      productId: product.id,
      productName: product.name,
      noticeText: decision.reply || null,
    });
    return;
  }

  // Ответ или уточняющий вопрос.
  const appended = await appendMessage({
    conversationId: data.conversationId,
    authorType: "ai",
    text: decision.reply,
    originalLang: conversationLanguage,
    aiMeta: {
      model: turn.model,
      decision: decision.action,
      confidence: decision.confidence,
      usedArticleIds: decision.usedArticleIds,
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
    },
    guard: (conv) => conv.status === "ai" && conv.stateVersion === expectedVersion,
  });

  if (appended.skipped || !appended.message) {
    // Оператор забрал диалог, пока модель думала. Ответ не отправляем.
    await recordEvent(data.conversationId, "ai_reply_discarded", "ai", null, {
      reason: "Состояние диалога изменилось во время генерации",
      expectedVersion,
      preview: decision.reply.slice(0, 200),
    });
    log.info({ conversationId: data.conversationId }, "Ответ ИИ отброшен: диалог забрал оператор");
    return;
  }

  if (decision.action === "clarify") {
    await incrementClarifyRounds(data.conversationId);
  }

  // Русский перевод ответа ИИ — чтобы оператор читал переписку на русском.
  if (conversationLanguage !== OPERATOR_LANGUAGE) {
    await ensureTranslation({
      messageId: idToString(appended.message.id),
      text: decision.reply,
      sourceLang: conversationLanguage,
      targetLang: OPERATOR_LANGUAGE,
      productId: product.id,
      conversationId: data.conversationId,
      protectedTerms: [product.name],
    });
  }

  await deliverMessage(data.conversationId, idToString(appended.message.id));
  await publishConversationUpdate(data.conversationId);
  }, async () => {
    const current = await getConversationRow(data.conversationId);
    return current?.status === 'ai' && Number(current.state_version) === Number(conversationAfterLang.state_version);
  });
}

interface HandoffInput {
  conversationId: string;
  expectedVersion: number;
  reason: HandoffReason;
  summaryRu: string;
  language: string;
  productId: string;
  productName: string;
  /** Текст уведомления от ИИ на языке пользователя (если модель его сформулировала). */
  noticeText: string | null;
}

async function performHandoff(input: HandoffInput): Promise<void> {
  const result = await handoffToOperator(input.conversationId, input.reason, input.summaryRu, {
    expectedVersion: input.expectedVersion,
  });

  if (!result.ok) {
    log.info(
      { conversationId: input.conversationId },
      "Передача оператору не выполнена: состояние уже изменилось",
    );
    return;
  }

  // Сообщение пользователю на его языке о том, что подключается специалист.
  const notice = await handoffNoticeText(input.conversationId, input.language);

  if (notice.text) {
    const appended = await appendMessage({
      conversationId: input.conversationId,
      authorType: "system",
      text: notice.text,
      originalLang: notice.language,
      incrementUnread: false,
    });
    if (appended.message) {
      if (notice.language !== 'ru') await execute("INSERT INTO sova_message_translations (message_id,target_lang,text,provider,status) VALUES (?,'ru',?,'widget-cache','ok') ON DUPLICATE KEY UPDATE text=VALUES(text),status='ok'", [appended.message.id, notice.sourceText]);
      await deliverMessage(input.conversationId, idToString(appended.message.id));
    }
  }

  await publishClientStatus(input.conversationId);
  await publishConversationUpdate(input.conversationId);
  await notifyHandoff(input.conversationId, input.reason, input.summaryRu);
}

/**
 * Текст уведомления о передаче оператору берётся из настроек канала
 * (задаётся на русском) и переводится на язык пользователя.
 */
async function handoffNoticeText(
  conversationId: string,
  language: string,
): Promise<{ text: string; language: string; sourceText: string }> {
  const conversation = await getConversationRow(conversationId);
  if (!conversation) return { text: '', language: 'ru', sourceText: '' };
  const channel = await getChannelRowForConversation(conversation);
  const uiLanguage = await getWidgetLanguage(channel.id, conversation.end_user_id);
  const localized = await localizeChannel(channel, uiLanguage || language, uiLanguage ? { previewLanguage: uiLanguage } : {});
  return { text: localized.settings.handoffNotice, language: localized.localization.effectiveLanguage, sourceText: localizationSource(channel).texts.handoffNotice };
}

/** История диалога для модели: только то, что видел пользователь. */
async function buildHistory(
  conversationId: string,
  conversationLanguage: string | null,
): Promise<AiHistoryItem[]> {
  return buildAiHistory(conversationId, conversationLanguage, 20);
}
