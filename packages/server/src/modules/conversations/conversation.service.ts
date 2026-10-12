import { scheduleLearning } from "../knowledge/learning.service.js";
/**
 * Диалоги: состояния, переходы, списки и фильтры.
 *
 * Состояния: ai → waiting_operator → operator → (ai | closed).
 * Каждый переход увеличивает state_version. Фоновые задания ИИ используют
 * state_version как оптимистическую блокировку: если версия изменилась,
 * сгенерированный ответ не отправляется.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  HANDOFF_REASON_RU,
  type ConversationDetailDto,
  type ConversationListItemDto,
  type ConversationStatus,
  type HandoffReason,
  type Paginated,
} from "@sova/shared";
import { dateToIso, execute, getPool, idToString, query, queryOne } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { moduleLogger } from "../../infra/logger.js";
import { endUserDisplayName, endUserRowToDto, type EndUserRow } from "../users/end-user.service.js";
import type { ChannelRow } from "../channels/channel.service.js";
import { recordEvent } from "../events/event.service.js";

const log = moduleLogger("conversations");

export interface ConversationRow extends RowDataPacket {
  id: string;
  product_id: string;
  channel_id: string;
  end_user_id: string;
  status: ConversationStatus;
  state_version: number;
  assigned_operator_id: string | null;
  language: string | null;
  language_locked: number;
  language_established: number;
  last_seq: number;
  handoff_reason: HandoffReason | null;
  handoff_summary_ru: string | null;
  handoff_at: Date | null;
  unread_for_operator: number;
  ai_clarify_rounds: number;
  last_message_at: Date | null;
  last_message_preview: string | null;
  previous_conversation_id: string | null;
  closed_at: Date | null;
  closed_by_operator_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ConversationJoinedRow extends ConversationRow {
  product_name: string;
  channel_name: string;
  channel_type: ConversationListItemDto["channelType"];
  user_display_name: string | null;
  user_external_id: string | null;
  user_is_verified: number;
}

const JOINED_SELECT = `
  SELECT c.*,
         p.name AS product_name,
         ch.name AS channel_name,
         ch.type AS channel_type,
         u.display_name AS user_display_name,
         u.external_id AS user_external_id,
         u.is_verified AS user_is_verified
    FROM sova_conversations c
    JOIN sova_products p ON p.id = c.product_id
    JOIN sova_channels ch ON ch.id = c.channel_id
    JOIN sova_end_users u ON u.id = c.end_user_id
`;

function joinedRowToListItem(row: ConversationJoinedRow): ConversationListItemDto {
  const name =
    row.user_display_name?.trim() ||
    (row.user_external_id ? `ID ${row.user_external_id}` : `Гость #${idToString(row.end_user_id)}`);
  return {
    id: idToString(row.id),
    productId: idToString(row.product_id),
    productName: row.product_name,
    channelId: idToString(row.channel_id),
    channelName: row.channel_name,
    channelType: row.channel_type,
    endUserId: idToString(row.end_user_id),
    endUserName: name,
    endUserIsVerified: row.user_is_verified === 1,
    status: row.status,
    language: row.language,
    unreadCount: Number(row.unread_for_operator ?? 0),
    lastMessageAt: dateToIso(row.last_message_at),
    lastMessagePreview: row.last_message_preview,
    handoffReason: row.handoff_reason,
    assignedOperatorId: row.assigned_operator_id ? idToString(row.assigned_operator_id) : null,
    createdAt: dateToIso(row.created_at) ?? "",
  };
}

export async function getConversationRow(id: string): Promise<ConversationRow | null> {
  return queryOne<ConversationRow>("SELECT * FROM sova_conversations WHERE id = ? LIMIT 1", [id]);
}

export async function requireConversationRow(id: string): Promise<ConversationRow> {
  const row = await getConversationRow(id);
  if (!row) throw errors.notFound("Диалог не найден");
  return row;
}

export async function getConversationListItem(id: string): Promise<ConversationListItemDto> {
  const row = await queryOne<ConversationJoinedRow>(`${JOINED_SELECT} WHERE c.id = ? LIMIT 1`, [id]);
  if (!row) throw errors.notFound("Диалог не найден");
  return joinedRowToListItem(row);
}

export async function getConversationDetail(id: string): Promise<ConversationDetailDto> {
  const row = await queryOne<ConversationJoinedRow>(`${JOINED_SELECT} WHERE c.id = ? LIMIT 1`, [id]);
  if (!row) throw errors.notFound("Диалог не найден");
  const endUser = await queryOne<EndUserRow>("SELECT * FROM sova_end_users WHERE id = ? LIMIT 1", [
    row.end_user_id,
  ]);
  if (!endUser) throw errors.notFound("Пользователь диалога не найден");

  return {
    ...joinedRowToListItem(row),
    handoffSummaryRu: row.handoff_summary_ru,
    handoffAt: dateToIso(row.handoff_at),
    stateVersion: Number(row.state_version),
    closedAt: dateToIso(row.closed_at),
    previousConversationId: row.previous_conversation_id
      ? idToString(row.previous_conversation_id)
      : null,
    endUser: endUserRowToDto(endUser),
  };
}

export interface ConversationFilter {
  productId?: string;
  channelId?: string;
  status?: ConversationStatus[];
  onlyUnread?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listConversations(
  filter: ConversationFilter,
): Promise<Paginated<ConversationListItemDto>> {
  const where: string[] = ["EXISTS (SELECT 1 FROM sova_messages vm LEFT JOIN sova_screening vs ON vs.message_id=vm.id WHERE vm.conversation_id=c.id AND vm.author_type='user' AND (vs.verdict IS NULL OR vs.verdict='allowed'))"];
  const params: unknown[] = [];

  if (filter.productId) {
    where.push("c.product_id = ?");
    params.push(filter.productId);
  }
  if (filter.channelId) {
    where.push("c.channel_id = ?");
    params.push(filter.channelId);
  }
  if (filter.status && filter.status.length > 0) {
    where.push(`c.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.onlyUnread) {
    where.push("c.unread_for_operator > 0");
  }
  if (filter.search && filter.search.trim()) {
    // Поиск по тексту переписки и по имени пользователя.
    where.push(`(
      u.display_name LIKE ?
      OR u.external_id LIKE ?
      OR EXISTS (
        SELECT 1 FROM sova_messages m
         WHERE m.conversation_id = c.id
           AND (m.original_text LIKE ? OR EXISTS (
                 SELECT 1 FROM sova_message_translations t
                  WHERE t.message_id = m.id AND t.text LIKE ?))
         LIMIT 1
      ))`);
    const like = `%${filter.search.trim()}%`;
    params.push(like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  const rows = await query<ConversationJoinedRow>(
    `${JOINED_SELECT} ${whereSql}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const countRow = await queryOne<RowDataPacket>(
    `SELECT COUNT(*) AS total
       FROM sova_conversations c
       JOIN sova_products p ON p.id = c.product_id
       JOIN sova_channels ch ON ch.id = c.channel_id
       JOIN sova_end_users u ON u.id = c.end_user_id
       ${whereSql}`,
    params,
  );

  return {
    items: rows.map(joinedRowToListItem),
    total: Number(countRow?.total ?? 0),
    limit,
    offset,
  };
}

/** Последний диалог пользователя в канале (в том числе закрытый). */
export async function getLatestConversation(
  endUserId: string,
  channelId: string,
): Promise<ConversationRow | null> {
  return queryOne<ConversationRow>(
    `SELECT * FROM sova_conversations
      WHERE end_user_id = ? AND channel_id = ?
      ORDER BY created_at DESC LIMIT 1`,
    [endUserId, channelId],
  );
}

export async function createConversation(input: {
  productId: string;
  channelId: string;
  endUserId: string;
  language: string | null;
  status?: ConversationStatus;
  previousConversationId?: string | null;
}): Promise<ConversationRow> {
  const res = await execute(
    `INSERT INTO sova_conversations
       (product_id, channel_id, end_user_id, status, language, previous_conversation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.productId,
      input.channelId,
      input.endUserId,
      input.status ?? "ai",
      input.language,
      input.previousConversationId ?? null,
    ],
  );
  const row = await getConversationRow(String(res.insertId));
  if (!row) throw errors.internal("Диалог не создан");
  await recordEvent(idToString(row.id), "conversation_created", "system", null, {
    channelId: input.channelId,
  });
  return row;
}

/**
 * Возвращает диалог, в который нужно записать входящее сообщение.
 * Если последний диалог закрыт — применяется политика продукта reopen_policy.
 */
export async function resolveConversationForIncoming(params: {
  endUser: EndUserRow;
  channel: ChannelRow;
  reopenPolicy: "reopen_to_ai" | "reopen_to_operator" | "new_conversation";
  languageHint: string | null;
}): Promise<ConversationRow> {
  const endUserId = idToString(params.endUser.id);
  const channelId = idToString(params.channel.id);
  const productId = idToString(params.channel.product_id);

  const latest = await getLatestConversation(endUserId, channelId);

  if (!latest) {
    return createConversation({
      productId,
      channelId,
      endUserId,
      language: params.languageHint ?? params.endUser.language ?? null,
    });
  }

  if (latest.status !== "closed") return latest;

  if (params.reopenPolicy === "new_conversation") {
    return createConversation({
      productId,
      channelId,
      endUserId,
      language: latest.language ?? params.languageHint ?? null,
      previousConversationId: idToString(latest.id),
    });
  }

  const nextStatus: ConversationStatus =
    params.reopenPolicy === "reopen_to_operator" ? "waiting_operator" : "ai";

  await execute(
    `UPDATE sova_conversations
        SET status = ?, state_version = state_version + 1, closed_at = NULL,
            closed_by_operator_id = NULL, ai_clarify_rounds = 0,
            handoff_reason = ?, handoff_at = ?
      WHERE id = ?`,
    [
      nextStatus,
      nextStatus === "waiting_operator" ? "rule_match" : null,
      nextStatus === "waiting_operator" ? new Date() : null,
      latest.id,
    ],
  );
  await recordEvent(idToString(latest.id), "conversation_reopened", "user", endUserId, {
    policy: params.reopenPolicy,
  });

  const updated = await getConversationRow(idToString(latest.id));
  return updated ?? latest;
}

/** Обновляет язык диалога, если он ещё не зафиксирован вручную. */
export async function setConversationLanguage(
  conversationId: string,
  language: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (options.force) {
    await execute("UPDATE sova_conversations SET language = ?, language_locked = 1 WHERE id = ?", [
      language,
      conversationId,
    ]);
    await recordEvent(conversationId, "language_set_manually", "operator", null, { language });
    return;
  }
  await execute(
      "UPDATE sova_conversations SET language = ?, language_established = 1 WHERE id = ? AND language_locked = 0",
      [language, conversationId],
  );
}

export interface TransitionResult {
  ok: boolean;
  conversation: ConversationRow;
}

/**
 * Переход состояния с проверкой ожидаемой версии.
 * Если expectedVersion передан и не совпадает — переход не выполняется (ok=false).
 */
async function transition(
  conversationId: string,
  patch: {
    status: ConversationStatus;
    assignedOperatorId?: string | null;
    handoffReason?: HandoffReason | null;
    handoffSummaryRu?: string | null;
    resetClarify?: boolean;
    closedByOperatorId?: string | null;
  },
  options: { expectedVersion?: number; expectedStatus?: ConversationStatus[] } = {},
): Promise<TransitionResult> {
  const sets: string[] = ["status = ?", "state_version = state_version + 1"];
  const params: unknown[] = [patch.status];

  if (patch.assignedOperatorId !== undefined) {
    sets.push("assigned_operator_id = ?");
    params.push(patch.assignedOperatorId);
  }
  if (patch.handoffReason !== undefined) {
    sets.push("handoff_reason = ?", "handoff_at = ?");
    params.push(patch.handoffReason, patch.handoffReason ? new Date() : null);
  }
  if (patch.handoffSummaryRu !== undefined) {
    sets.push("handoff_summary_ru = ?");
    params.push(patch.handoffSummaryRu);
  }
  if (patch.resetClarify) {
    sets.push("ai_clarify_rounds = 0");
  }
  if (patch.status === "closed") {
    sets.push("closed_at = UTC_TIMESTAMP(3)", "closed_by_operator_id = ?");
    params.push(patch.closedByOperatorId ?? null);
  } else {
    sets.push("closed_at = NULL", "closed_by_operator_id = NULL");
  }

  let where = "WHERE id = ?";
  params.push(conversationId);

  if (options.expectedVersion !== undefined) {
    where += " AND state_version = ?";
    params.push(options.expectedVersion);
  }
  if (options.expectedStatus && options.expectedStatus.length > 0) {
    where += ` AND status IN (${options.expectedStatus.map(() => "?").join(",")})`;
    params.push(...options.expectedStatus);
  }

  const res = await execute(`UPDATE sova_conversations SET ${sets.join(", ")} ${where}`, params);
  const conversation = await requireConversationRow(conversationId);
  return { ok: (res.affectedRows ?? 0) > 0, conversation };
}

export async function takeByOperator(
  conversationId: string,
  operatorId: string,
): Promise<ConversationRow> {
  const current = await requireConversationRow(conversationId);
  const result = await transition(conversationId, {
    status: "operator",
    assignedOperatorId: operatorId,
    handoffReason: current.handoff_reason ?? "manual",
  });
  await recordEvent(conversationId, "operator_took", "operator", operatorId, {
    previousStatus: current.status,
  });
  log.info({ conversationId, operatorId }, "Оператор взял диалог");
  return result.conversation;
}

export async function returnToAi(
  conversationId: string,
  operatorId: string,
): Promise<ConversationRow> {
  const result = await transition(conversationId, {
    status: "ai",
    assignedOperatorId: null,
    handoffReason: null,
    handoffSummaryRu: null,
    resetClarify: true,
  });
  await recordEvent(conversationId, "returned_to_ai", "operator", operatorId, {});
  log.info({ conversationId, operatorId }, "Диалог возвращён ИИ");
  return result.conversation;
}

export async function closeConversation(
  conversationId: string,
  operatorId: string,
): Promise<ConversationRow> {
  const result = await transition(conversationId, {
    status: "closed",
    closedByOperatorId: operatorId,
  });
  await recordEvent(conversationId, "conversation_closed", "operator", operatorId, {});
  await scheduleLearning(conversationId);
  return result.conversation;
}

/**
 * Передача оператору из фонового задания.
 * Выполняется только если диалог всё ещё в состоянии `ai` и версия не изменилась.
 */
export async function handoffToOperator(
  conversationId: string,
  reason: HandoffReason,
  summaryRu: string,
  options: { expectedVersion?: number } = {},
): Promise<TransitionResult> {
  const result = await transition(
    conversationId,
    {
      status: "waiting_operator",
      handoffReason: reason,
      handoffSummaryRu: summaryRu,
    },
    { expectedVersion: options.expectedVersion, expectedStatus: ["ai"] },
  );

  if (result.ok) {
    await recordEvent(conversationId, "handoff", "ai", null, {
      reason,
      reasonRu: HANDOFF_REASON_RU[reason],
    });
    log.info({ conversationId, reason }, "Диалог передан оператору");
  } else {
    log.info({ conversationId, reason }, "Передача оператору пропущена: состояние изменилось");
  }
  return result;
}

export async function incrementClarifyRounds(conversationId: string): Promise<void> {
  await execute(
    "UPDATE sova_conversations SET ai_clarify_rounds = ai_clarify_rounds + 1 WHERE id = ?",
    [conversationId],
  );
}

/** Счётчик непрочитанного для оператора. */
export async function markConversationRead(
  conversationId: string,
  operatorId: string,
): Promise<void> {
  const conv = await requireConversationRow(conversationId);
  await execute(
    `INSERT INTO sova_conversation_reads (operator_id, conversation_id, last_read_seq)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_read_seq = VALUES(last_read_seq)`,
    [operatorId, conversationId, conv.last_seq],
  );
  await execute("UPDATE sova_conversations SET unread_for_operator = 0 WHERE id = ?", [conversationId]);
}

export async function countUnread(filter: { productId?: string } = {}): Promise<number> {
  const params: unknown[] = [];
  let where = "WHERE unread_for_operator > 0 AND status <> 'closed' AND EXISTS (SELECT 1 FROM sova_messages vm LEFT JOIN sova_screening vs ON vs.message_id=vm.id WHERE vm.conversation_id=sova_conversations.id AND vm.author_type='user' AND (vs.verdict IS NULL OR vs.verdict='allowed'))";
  if (filter.productId) {
    where += " AND product_id = ?";
    params.push(filter.productId);
  }
  const row = await queryOne<RowDataPacket>(
    `SELECT COUNT(*) AS total FROM sova_conversations ${where}`,
    params,
  );
  return Number(row?.total ?? 0);
}

/** One badge unit is one conversation needing this operator's attention. */
export async function countOperatorAttention(operatorId: string): Promise<number> {
  const row = await queryOne<RowDataPacket>(
    `SELECT COUNT(*) AS total FROM sova_conversations c
      WHERE (c.status='waiting_operator' OR
        (c.status='operator' AND c.unread_for_operator > 0 AND (c.assigned_operator_id=? OR c.assigned_operator_id IS NULL)))
      AND EXISTS (SELECT 1 FROM sova_messages m LEFT JOIN sova_screening s ON s.message_id=m.id
        WHERE m.conversation_id=c.id AND m.author_type='user' AND (s.verdict IS NULL OR s.verdict='allowed'))`,
    [operatorId],
  );
  return Number(row?.total ?? 0);
}

/** Обновление сводки диалога после записи сообщения (в той же транзакции). */
export async function updateConversationSummary(
  conn: PoolConnection,
  conversationId: string,
  patch: { preview: string; incrementUnread: boolean },
): Promise<void> {
  await conn.execute(
    `UPDATE sova_conversations
        SET last_message_at = UTC_TIMESTAMP(3),
            last_message_preview = ?,
            unread_for_operator = unread_for_operator + ?
      WHERE id = ?`,
    [patch.preview.slice(0, 250), patch.incrementUnread ? 1 : 0, conversationId],
  );
}

/** Диалоги пользователя (для панели: «другие обращения этого пользователя»). */
export async function listUserConversations(
  endUserId: string,
  excludeId?: string,
): Promise<ConversationListItemDto[]> {
  const params: unknown[] = [endUserId];
  let where = "WHERE c.end_user_id = ?";
  if (excludeId) {
    where += " AND c.id <> ?";
    params.push(excludeId);
  }
  const rows = await query<ConversationJoinedRow>(
    `${JOINED_SELECT} ${where} ORDER BY c.created_at DESC LIMIT 20`,
    params,
  );
  return rows.map(joinedRowToListItem);
}

export async function pingPool(): Promise<void> {
  await getPool().query("SELECT 1");
}
