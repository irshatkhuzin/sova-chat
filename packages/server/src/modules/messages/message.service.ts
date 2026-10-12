/**
 * Сообщения: запись с порядковым номером, идемпотентность, выдача для клиента и панели.
 *
 * Правила:
 *  • сначала запись в MySQL, потом подтверждение клиенту;
 *  • seq — монотонный номер внутри диалога, выдаётся под блокировкой строки диалога;
 *  • повторная отправка с тем же client_msg_id не создаёт дубль;
 *  • оригинал сообщения никогда не изменяется, перевод хранится отдельно.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { loadReadReceipts } from './read-receipts.service.js';
import type {
  AiMessageMeta,
  AttachmentDto,
  ClientMessageDto,
  MessageAuthorType,
  MessageDeliveryStatus,
  PanelMessageDto,
} from "@sova/shared";
import { config } from "../../config.js";
import {
  dateToIso,
  execute,
  idToString,
  parseJson,
  query,
  queryOne,
  withTransaction,
} from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { updateConversationSummary } from "../conversations/conversation.service.js";

const OPERATOR_LANG = config.translation.operatorLanguage;

export interface MessageRow extends RowDataPacket {
  id: string;
  conversation_id: string;
  seq: number;
  author_type: MessageAuthorType;
  author_operator_id: string | null;
  client_msg_id: string | null;
  original_lang: string | null;
  outbound_lang: string | null;
  original_text: string;
  delivery_status: MessageDeliveryStatus;
  failure_reason: string | null;
  ai_meta: string | null;
  has_attachments: number;
  is_internal: number;
  created_at: Date;
}

interface TranslationRow extends RowDataPacket {
  message_id: string;
  target_lang: string;
  text: string | null;
  status: "pending" | "ok" | "failed";
  error: string | null;
}

interface AttachmentRow extends RowDataPacket {
  id: string;
  message_id: string | null;
  file_name: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

export interface AppendMessageInput {
  conversationId: string;
  authorType: MessageAuthorType;
  authorOperatorId?: string | null;
  text: string;
  originalLang?: string | null;
  clientMsgId?: string | null;
  deliveryStatus?: MessageDeliveryStatus;
  aiMeta?: AiMessageMeta | null;
  attachmentIds?: string[];
  /** Внутреннее сообщение видно только в панели. */
  isInternal?: boolean;
  /** Увеличивать ли счётчик непрочитанного оператором. */
  incrementUnread?: boolean;
  /** Обновить очередь оператора только после проверки фильтром. */
  deferSummary?: boolean;
  /**
   * Проверка состояния диалога внутри той же транзакции (строка диалога уже
   * заблокирована). Если вернёт false, сообщение не записывается.
   * Используется, чтобы ответ ИИ не был отправлен после того, как оператор
   * забрал диалог.
   */
  guard?: (conversation: { status: string; stateVersion: number }) => boolean;
}

export interface AppendMessageResult {
  message: MessageRow | null;
  /** true, если сообщение с таким client_msg_id уже существовало. */
  duplicate: boolean;
  /** true, если запись отменена проверкой guard. */
  skipped: boolean;
}

export async function appendMessage(input: AppendMessageInput): Promise<AppendMessageResult> {
  if (input.text.length > config.limits.maxMessageLength) {
    throw errors.validation(
      `Сообщение длиннее ${config.limits.maxMessageLength} символов`,
    );
  }

  return withTransaction(async (conn: PoolConnection) => {
    // Блокируем строку диалога: она же хранит счётчик seq.
    const [convRows] = await conn.query<RowDataPacket[]>(
      "SELECT id, last_seq, status, state_version FROM sova_conversations WHERE id = ? FOR UPDATE",
      [input.conversationId],
    );
    const conv = convRows[0];
    if (!conv) throw errors.notFound("Диалог не найден");

    if (
      input.guard &&
      !input.guard({ status: String(conv.status), stateVersion: Number(conv.state_version) })
    ) {
      return { message: null, duplicate: false, skipped: true };
    }

    if (input.clientMsgId) {
      const [existingRows] = await conn.query<MessageRow[]>(
        "SELECT * FROM sova_messages WHERE conversation_id = ? AND client_msg_id = ? LIMIT 1",
        [input.conversationId, input.clientMsgId],
      );
      const existing = existingRows[0];
      if (existing) {
        return { message: existing, duplicate: true, skipped: false };
      }
    }

    const seq = Number(conv.last_seq) + 1;

    const [result] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
      `INSERT INTO sova_messages
         (conversation_id, seq, author_type, author_operator_id, client_msg_id, original_lang,
          original_text, delivery_status, ai_meta, has_attachments, is_internal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.conversationId,
        seq,
        input.authorType,
        input.authorOperatorId ?? null,
        input.clientMsgId ?? null,
        input.originalLang ?? null,
        input.text,
        input.deliveryStatus ?? "sent",
        input.aiMeta ? JSON.stringify(input.aiMeta) : null,
        input.attachmentIds && input.attachmentIds.length > 0 ? 1 : 0,
        input.isInternal ? 1 : 0,
      ],
    );

    const messageId = String(result.insertId);

    await conn.execute("UPDATE sova_conversations SET last_seq = ? WHERE id = ?", [
      seq,
      input.conversationId,
    ]);

    if (input.attachmentIds && input.attachmentIds.length > 0) {
      const ids=[...new Set(input.attachmentIds)];
      const placeholders = ids.map(() => "?").join(",");
      const [bound]=await conn.execute<import("mysql2/promise").ResultSetHeader>(
        `UPDATE sova_attachments SET message_id = ?
          WHERE id IN (${placeholders}) AND conversation_id = ? AND message_id IS NULL`,
        [messageId, ...ids, input.conversationId],
      );
      if(bound.affectedRows!==ids.length)throw errors.validation("Вложение уже отправлено или принадлежит другому диалогу. Загрузите файл заново.");
    }

    if (input.deferSummary) {
      await conn.execute("INSERT INTO sova_screening (message_id) VALUES (?)", [messageId]);
    }
    if (!input.isInternal && !input.deferSummary) {
      await updateConversationSummary(conn, input.conversationId, {
        preview: previewFor(input.authorType, input.text),
        incrementUnread: input.incrementUnread ?? false,
      });
    }

    const [rows] = await conn.query<MessageRow[]>("SELECT * FROM sova_messages WHERE id = ?", [
      messageId,
    ]);
    const message = rows[0];
    if (!message) throw errors.internal("Сообщение не сохранено");
    return { message, duplicate: false, skipped: false };
  });
}

function previewFor(authorType: MessageAuthorType, text: string): string {
  const prefix =
    authorType === "operator" ? "Вы: " : authorType === "ai" ? "ИИ: " : authorType === "system" ? "" : "";
  return `${prefix}${text.replace(/\s+/g, " ").trim()}`;
}

export async function getMessageRow(id: string): Promise<MessageRow | null> {
  return queryOne<MessageRow>("SELECT * FROM sova_messages WHERE id = ? LIMIT 1", [id]);
}

export async function setDeliveryStatus(
  messageId: string,
  status: MessageDeliveryStatus,
  failureReason: string | null = null,
): Promise<void> {
  await execute("UPDATE sova_messages SET delivery_status = ?, failure_reason = ? WHERE id = ?", [
    status,
    failureReason,
    messageId,
  ]);
}

export async function setMessageLanguage(messageId: string, lang: string): Promise<void> {
  await execute("UPDATE sova_messages SET original_lang = ? WHERE id = ?", [lang, messageId]);
}

/** История диалога для передачи модели. */
export async function listRecentMessagesForAi(
  conversationId: string,
  limit = 20,
): Promise<MessageRow[]> {
  const rows = await query<MessageRow>(
    `SELECT * FROM sova_messages
      WHERE conversation_id = ? AND is_internal = 0 AND NOT EXISTS (SELECT 1 FROM sova_screening fs WHERE fs.message_id=sova_messages.id AND fs.verdict='rejected')
      ORDER BY seq DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
    [conversationId],
  );
  return rows.reverse();
}

/**
 * История диалога для модели: текст в том виде, в котором его видел пользователь.
 * Сообщения оператора берутся в переводе, сообщения с неудавшейся отправкой пропускаются.
 */
export async function buildAiHistory(
  conversationId: string,
  conversationLanguage: string | null,
  limit = 20,
): Promise<Array<{ role: "user" | "agent"; text: string }>> {
  const rows = await listRecentMessagesForAi(conversationId, limit);
  const translations = await loadTranslations(rows.map((r) => idToString(r.id)));
  const history: Array<{ role: "user" | "agent"; text: string }> = [];

  for (const row of rows) {
    if (row.author_type === "user") {
      history.push({ role: "user", text: row.original_text });
      continue;
    }
    if (row.delivery_status === "failed") continue;
    const outbound = outboundTextFor(row, translations.get(idToString(row.id)) ?? [], conversationLanguage);
    if (outbound.status === "pending" || outbound.status === "failed") continue;
    if (outbound.text) history.push({ role: "agent", text: outbound.text });
  }

  return history;
}

async function loadTranslations(messageIds: string[]): Promise<Map<string, TranslationRow[]>> {
  const map = new Map<string, TranslationRow[]>();
  if (messageIds.length === 0) return map;
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = await query<TranslationRow>(
    `SELECT message_id, target_lang, text, status, error
       FROM sova_message_translations WHERE message_id IN (${placeholders})`,
    messageIds,
  );
  for (const row of rows) {
    const key = idToString(row.message_id);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

async function loadAttachments(messageIds: string[]): Promise<Map<string, AttachmentDto[]>> {
  const map = new Map<string, AttachmentDto[]>();
  if (messageIds.length === 0) return map;
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = await query<AttachmentRow>(
    `SELECT id, message_id, file_name, mime, size_bytes, width, height
       FROM sova_attachments WHERE message_id IN (${placeholders})`,
    messageIds,
  );
  for (const row of rows) {
    if (!row.message_id) continue;
    const key = idToString(row.message_id);
    const list = map.get(key) ?? [];
    list.push({
      id: row.id,
      fileName: row.file_name,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      url: `${config.publicUrl}/api/v1/files/${row.id}`,
      width: row.width,
      height: row.height,
    });
    map.set(key, list);
  }
  return map;
}

/** Текст, который должен увидеть пользователь. */
export function outboundTextFor(
  row: MessageRow,
  translations: TranslationRow[],
  conversationLanguage: string | null,
): { text: string | null; lang: string | null; status: "none" | "pending" | "ok" | "failed" } {
  if (row.author_type !== "operator" && row.author_type !== "ai" && row.author_type !== "system") {
    return { text: row.original_text, lang: row.original_lang, status: "none" };
  }

  // AI/system replies are generated in their delivery language. Never reinterpret history.
  if (row.author_type === "ai" || row.author_type === "system") {
    return { text: row.original_text, lang: row.original_lang, status: "none" };
  }
  const legacySentLanguage = row.delivery_status === "sent"
    ? translations.find(t => t.status === "ok" && t.target_lang !== OPERATOR_LANG)?.target_lang ?? row.original_lang
    : null;
  const target = row.outbound_lang ?? legacySentLanguage ?? conversationLanguage ?? row.original_lang ?? null;
  if (!target || target === row.original_lang) {
    return { text: row.original_text, lang: row.original_lang, status: "none" };
  }

  const exact = translations.find((t) => t.target_lang === target);
  const fallback = translations.find((t) => t.target_lang !== OPERATOR_LANG);
  const chosen = exact ?? fallback;
  if (!chosen) return { text: null, lang: target, status: "pending" };
  if (chosen.status === "ok" && chosen.text) {
    return { text: chosen.text, lang: chosen.target_lang, status: "ok" };
  }
  return { text: null, lang: chosen.target_lang, status: chosen.status === "failed" ? "failed" : "pending" };
}

/** Сообщения для клиента: оператор и ИИ неразличимы, показывается только нужный язык. */
export async function listMessagesForClient(
  conversationId: string,
  conversationLanguage: string | null,
  options: { afterSeq?: number; limit?: number } = {},
): Promise<ClientMessageDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const afterSeq = options.afterSeq ?? 0;

  const rows = await query<MessageRow>(
    `SELECT * FROM sova_messages
      WHERE conversation_id = ? AND is_internal = 0 AND seq > ?
      ORDER BY seq ASC LIMIT ${limit}`,
    [conversationId, afterSeq],
  );

  const ids = rows.map((r) => idToString(r.id));
  const translations = await loadTranslations(ids);
  const attachments = await loadAttachments(ids);

  const result: ClientMessageDto[] = [];
  for (const row of rows) {
    const id = idToString(row.id);
    const dto = toClientDto(row, translations.get(id) ?? [], attachments.get(id) ?? [], conversationLanguage);
    if (dto) result.push(dto);
  }
  return result;
}

/**
 * Сообщение для клиента. Возвращает null, если текст ещё не готов
 * (например, перевод ответа оператора не выполнен) — такое сообщение
 * пользователю показывать нельзя.
 */
export function toClientDto(
  row: MessageRow,
  translations: TranslationRow[],
  attachments: AttachmentDto[],
  conversationLanguage: string | null,
): ClientMessageDto | null {
  if (row.is_internal === 1) return null;
  if (row.delivery_status !== "sent") return null;

  let text: string;
  if (row.author_type === "user") {
    text = row.original_text;
  } else {
    const outbound = outboundTextFor(row, translations, conversationLanguage);
    if (outbound.status === "pending" || outbound.status === "failed" || !outbound.text) return null;
    text = outbound.text;
  }

  const author: ClientMessageDto["author"] =
    row.author_type === "user" ? "user" : row.author_type === "system" ? "system" : "agent";

  return {
    id: idToString(row.id),
    seq: Number(row.seq),
    author,
    text,
    createdAt: dateToIso(row.created_at) ?? new Date().toISOString(),
    clientMsgId: row.client_msg_id,
    attachments,
  };
}

/** Сообщения для панели: оригинал + русский перевод + отправленный текст. */
export async function listMessagesForPanel(
  conversationId: string,
  conversationLanguage: string | null,
  options: { limit?: number; beforeSeq?: number } = {},
): Promise<PanelMessageDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const params: unknown[] = [conversationId];
  let where = "WHERE conversation_id = ? AND NOT EXISTS (SELECT 1 FROM sova_screening s WHERE s.message_id=sova_messages.id AND s.verdict IN ('pending','rejected'))";
  if (options.beforeSeq) {
    where += " AND seq < ?";
    params.push(options.beforeSeq);
  }

  const rows = await query<MessageRow>(
    `SELECT * FROM sova_messages ${where} ORDER BY seq DESC LIMIT ${limit}`,
    params,
  );
  rows.reverse();

  const ids = rows.map((r) => idToString(r.id));
  const translations = await loadTranslations(ids);
  const attachments = await loadAttachments(ids);
  const operatorNames = await loadOperatorNames(rows);
  const reads = await loadReadReceipts(ids);

  return rows.map((row) => {
    const id = idToString(row.id);
    return { ...toPanelDto(
      row,
      translations.get(id) ?? [],
      attachments.get(id) ?? [],
      conversationLanguage,
      operatorNames,
    ), clientReadAt: reads.get(id) ?? null };
  });
}

async function loadOperatorNames(rows: MessageRow[]): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.author_operator_id).filter((v): v is string => Boolean(v))),
  );
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const operators = await query<RowDataPacket>(
    `SELECT id, display_name FROM sova_operators WHERE id IN (${placeholders})`,
    ids,
  );
  for (const op of operators) {
    map.set(idToString(op.id), String(op.display_name));
  }
  return map;
}

export function toPanelDto(
  row: MessageRow,
  translations: TranslationRow[],
  attachments: AttachmentDto[],
  conversationLanguage: string | null,
  operatorNames: Map<string, string> = new Map(),
): PanelMessageDto {
  const isFromUserSide = row.author_type === "user";
  const ruTranslation = translations.find((t) => t.target_lang === OPERATOR_LANG);

  let translationRu: string | null = null;
  let translationStatus: PanelMessageDto["translationStatus"] = "none";
  let translationError: string | null = null;

  if (isFromUserSide) {
    if (row.original_lang && row.original_lang !== OPERATOR_LANG) {
      if (!ruTranslation) {
        translationStatus = "pending";
      } else if (ruTranslation.status === "ok") {
        translationRu = ruTranslation.text;
        translationStatus = "ok";
      } else if (ruTranslation.status === "failed") {
        translationStatus = "failed";
        translationError = ruTranslation.error;
      } else {
        translationStatus = "pending";
      }
    }
  }

  const outbound = outboundTextFor(row, translations, conversationLanguage);
  if (!isFromUserSide) {
    translationStatus = outbound.status;
    if (outbound.status === "failed") {
      const failedRow = translations.find((t) => t.status === "failed");
      translationError = failedRow?.error ?? "Перевод не выполнен";
    }
    // Ответ ИИ пишется сразу на языке пользователя; для чтения оператором
    // сохраняется русский перевод.
    if (row.author_type === "ai" && ruTranslation?.status === "ok") {
      translationRu = ruTranslation.text;
    }
  }

  return {
    id: idToString(row.id),
    conversationId: idToString(row.conversation_id),
    seq: Number(row.seq),
    authorType: row.author_type,
    isInternal: row.is_internal === 1,
    authorOperatorId: row.author_operator_id ? idToString(row.author_operator_id) : null,
    authorName: row.author_operator_id
      ? operatorNames.get(idToString(row.author_operator_id)) ?? null
      : null,
    originalText: row.original_text,
    originalLang: row.original_lang,
    translationRu,
    outboundText: isFromUserSide ? null : outbound.text,
    outboundLang: isFromUserSide ? null : outbound.lang,
    translationStatus,
    translationError,
    deliveryStatus: row.delivery_status,
    failureReason: row.failure_reason,
    aiMeta: parseJson<AiMessageMeta | null>(row.ai_meta, null),
    attachments,
    createdAt: dateToIso(row.created_at) ?? "",
  };
}

/** Собирает DTO одного сообщения (для realtime-событий). */
export async function buildMessageDtos(
  messageId: string,
  conversationLanguage: string | null,
): Promise<{ panel: PanelMessageDto; client: ClientMessageDto | null }> {
  const row = await getMessageRow(messageId);
  if (!row) throw errors.notFound("Сообщение не найдено");
  const translations = await loadTranslations([messageId]);
  const attachments = await loadAttachments([messageId]);
  const operatorNames = await loadOperatorNames([row]);
  const reads = await loadReadReceipts([messageId]);
  const t = translations.get(messageId) ?? [];
  const a = attachments.get(messageId) ?? [];
  return {
    panel: { ...toPanelDto(row, t, a, conversationLanguage, operatorNames), clientReadAt: reads.get(messageId) ?? null },
    client: toClientDto(row, t, a, conversationLanguage),
  };
}

/** Полнотекстовый поиск по сообщениям (используется в панели). */
export async function searchMessages(
  text: string,
  filter: { productId?: string; limit?: number } = {},
): Promise<Array<{ conversationId: string; messageId: string; snippet: string; createdAt: string }>> {
  const like = `%${text}%`;
  // Первый параметр относится к условию JOIN, далее — к WHERE.
  const params: unknown[] = [OPERATOR_LANG, like, like];
  let where = `WHERE (m.original_text LIKE ? OR t.text LIKE ?)`;
  if (filter.productId) {
    where += " AND c.product_id = ?";
    params.push(filter.productId);
  }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);

  const rows = await query<RowDataPacket>(
    `SELECT m.id, m.conversation_id, m.original_text, t.text AS translated, m.created_at
       FROM sova_messages m
       JOIN sova_conversations c ON c.id = m.conversation_id
       LEFT JOIN sova_message_translations t ON t.message_id = m.id AND t.target_lang = ?
       ${where}
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
    params,
  );

  return rows.map((row) => ({
    conversationId: idToString(row.conversation_id),
    messageId: idToString(row.id),
    snippet: String(row.translated ?? row.original_text).slice(0, 200),
    createdAt: dateToIso(row.created_at) ?? "",
  }));
}
