/**
 * API панели оператора: диалоги, сообщения, переходы состояний, заметки.
 * Все ответы оператора пишутся на русском, перевод выполняет сервер.
 */
import { Router } from "express";
import { z } from "zod";
import type { ConversationStatus } from "@sova/shared";
import { config } from "../../config.js";
import { dateToIso, execute, idToString, query } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import {
  closeConversation,
  countOperatorAttention,
  getConversationDetail,
  listConversations,
  listUserConversations,
  markConversationRead,
  requireConversationRow,
  returnToAi,
  setConversationLanguage,
  takeByOperator,
} from "../../modules/conversations/conversation.service.js";
import { listEvents, recordEvent } from "../../modules/events/event.service.js";
import { saveAttachment } from "../../modules/files/file.service.js";
import {
  appendMessage,
  buildMessageDtos,
  getMessageRow,
  listMessagesForPanel,
  searchMessages,
} from "../../modules/messages/message.service.js";
import { OPERATOR_LANGUAGE } from "../../modules/translation/translation.service.js";
import { enqueueOutbound } from "../../queue/queues.js";
import {
  deliverMessage,
  publishClientStatus,
  publishConversationUpdate,
} from "../../pipeline/delivery.js";
import { asyncHandler, rateLimit } from "../middleware.js";
import type { RowDataPacket } from "mysql2/promise";

import { feedbackSchema, listFeedback, saveFeedback } from '../../modules/knowledge/feedback.service.js';
import { readEnvironment } from '../../modules/users/client-environment.service.js';
export const conversationsRouter = Router();
conversationsRouter.get('/:id/environment',asyncHandler(async(req,res)=>{
 const c=await requireConversationRow(String(req.params.id));
 res.json({environment:await readEnvironment(String(c.end_user_id),String(c.channel_id))});
}));
conversationsRouter.get('/:id/feedback',asyncHandler(async(req,res)=>{
  const id=z.string().regex(/^\d+$/).parse(req.params.id);
  await requireConversationRow(id);
  res.json({rows:await listFeedback(id)});
}));
conversationsRouter.put('/:id/messages/:messageId/feedback',rateLimit({name:'message-feedback',limit:30,windowSec:60}),asyncHandler(async(req,res)=>{
  if(!req.operatorCtx) throw errors.unauthorized();
  const id=z.string().regex(/^\d+$/).parse(req.params.id);
  const messageId=z.string().regex(/^\d+$/).parse(req.params.messageId);
  await saveFeedback(id,messageId,String(req.operatorCtx.operator.id),feedbackSchema.parse(req.body));
  res.json({rows:await listFeedback(id)});
}));
import { setUserBlock } from '../../modules/users/moderation.service.js';
conversationsRouter.post('/:id/block',asyncHandler(async(req,res)=>{
  if(!req.operatorCtx)throw errors.unauthorized();
  const input=z.object({blocked:z.boolean(),reason:z.string().trim().min(1).max(500).optional()}).strict().parse(req.body);
  const conversation=await requireConversationRow(String(req.params.id));
  await setUserBlock(String(conversation.end_user_id),input.blocked,input.reason??'Блокировка оператором',String(req.operatorCtx.operator.id));
  res.json({conversation:await getConversationDetail(String(conversation.id))});
}));

const listQuerySchema = z.object({
  productId: z.string().optional(),
  channelId: z.string().optional(),
  status: z.string().optional(),
  unread: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

conversationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const statuses = q.status
      ? (q.status.split(",").filter(Boolean) as ConversationStatus[])
      : undefined;

    const result = await listConversations({
      productId: q.productId,
      channelId: q.channelId,
      status: statuses,
      onlyUnread: q.unread === "1",
      search: q.search,
      limit: q.limit,
      offset: q.offset,
    });
    res.json(result);
  }),
);

conversationsRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const text = String(req.query.q ?? "").trim();
    if (text.length < 2) {
      res.json({ items: [] });
      return;
    }
    const productId = req.query.productId ? String(req.query.productId) : undefined;
    const items = await searchMessages(text, { productId, limit: 50 });
    res.json({ items });
  }),
);

conversationsRouter.get(
  "/attention",
  asyncHandler(async (req, res) => {
    if (!req.operatorCtx) throw errors.unauthorized();
    res.json({ count: await countOperatorAttention(String(req.operatorCtx.operator.id)) });
  }),
);

conversationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const detail = await getConversationDetail(id);
    const other = await listUserConversations(detail.endUserId, id);
    res.json({ conversation: detail, otherConversations: other });
  }),
);

conversationsRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const conversation = await requireConversationRow(id);
    const beforeSeq = req.query.beforeSeq ? Number(req.query.beforeSeq) : undefined;
    const messages = await listMessagesForPanel(id, conversation.language, {
      limit: 200,
      beforeSeq: Number.isFinite(beforeSeq) ? beforeSeq : undefined,
    });
    res.json({ messages, lastSeq: Number(conversation.last_seq), status: conversation.status });
  }),
);

conversationsRouter.get(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const events = await listEvents(String(req.params.id));
    res.json({ events });
  }),
);

const sendSchema = z.object({
  textRu: z.string().min(1).max(config.limits.maxMessageLength),
  clientMsgId: z.string().max(64).optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
});

conversationsRouter.post(
  "/:id/messages",
  rateLimit({ name: "operator-messages", limit: 120, windowSec: 60 }),
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();

    const id = String(req.params.id);
    const input = sendSchema.parse(req.body);
    let conversation = await requireConversationRow(id);

    if (conversation.status === "closed") {
      throw errors.conflict("Диалог закрыт. Откройте его заново, чтобы ответить.");
    }

    // Ответ оператора автоматически означает, что он ведёт диалог.
    if (conversation.status !== "operator") {
      conversation = await takeByOperator(id, operator.operator.id);
      await publishClientStatus(id);
    }

    const targetLang = conversation.language ?? OPERATOR_LANGUAGE;
    const needsTranslation = targetLang !== OPERATOR_LANGUAGE;

    const appended = await appendMessage({
      conversationId: id,
      authorType: "operator",
      authorOperatorId: operator.operator.id,
      text: input.textRu.trim(),
      originalLang: OPERATOR_LANGUAGE,
      clientMsgId: input.clientMsgId ?? null,
      attachmentIds: input.attachmentIds,
      deliveryStatus: needsTranslation ? "pending" : "sent",
    });

    if (!appended.message) throw errors.internal("Сообщение не сохранено");
    const messageId = idToString(appended.message.id);

    if (!appended.duplicate) {
      if (needsTranslation) {
        await enqueueOutbound({ conversationId: id, messageId, targetLang });
        // В панели сообщение появляется сразу со статусом «отправляется».
        await deliverMessage(id, messageId, { toClient: false });
      } else {
        await deliverMessage(id, messageId);
      }
      await markConversationRead(id, operator.operator.id);
      await publishConversationUpdate(id);
    }

    const dtos = await buildMessageDtos(messageId, conversation.language);
    res.json({ message: dtos.panel });
  }),
);

/** Повторная отправка сообщения, перевод которого не удался. */
conversationsRouter.post(
  "/:id/messages/:messageId/retry",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const messageId = String(req.params.messageId);
    const message = await getMessageRow(messageId);
    if (!message || idToString(message.conversation_id) !== id) {
      throw errors.notFound("Сообщение не найдено");
    }
    if (message.author_type !== "operator") {
      throw errors.validation("Повторить можно только сообщение оператора");
    }

    const conversation = await requireConversationRow(id);
    const targetLang = conversation.language ?? OPERATOR_LANGUAGE;

    await execute("UPDATE sova_messages SET delivery_status = 'pending', failure_reason = NULL WHERE id = ?", [
      messageId,
    ]);
    await enqueueOutbound({ conversationId: id, messageId, targetLang, retry: true });
    await deliverMessage(id, messageId, { toClient: false });

    res.json({ ok: true });
  }),
);

conversationsRouter.post(
  "/:id/take",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    await takeByOperator(id, operator.operator.id);
    await markConversationRead(id, operator.operator.id);
    await publishClientStatus(id);
    await publishConversationUpdate(id);
    res.json({ conversation: await getConversationDetail(id) });
  }),
);

conversationsRouter.post(
  "/:id/return-to-ai",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    await returnToAi(id, operator.operator.id);
    await publishClientStatus(id);
    await publishConversationUpdate(id);
    res.json({ conversation: await getConversationDetail(id) });
  }),
);

conversationsRouter.post(
  "/:id/close",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    await closeConversation(id, operator.operator.id);
    await publishClientStatus(id);
    await publishConversationUpdate(id);
    res.json({ conversation: await getConversationDetail(id) });
  }),
);

conversationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    await markConversationRead(id, operator.operator.id);
    await publishConversationUpdate(id);
    res.json({ ok: true });
  }),
);

const languageSchema = z.object({ language: z.string().min(2).max(8) });

conversationsRouter.post(
  "/:id/language",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    const input = languageSchema.parse(req.body);
    await setConversationLanguage(id, input.language, { force: true });
    await publishConversationUpdate(id);
    res.json({ conversation: await getConversationDetail(id) });
  }),
);

/** Внутренние заметки — никогда не отправляются пользователю. */
const noteSchema = z.object({ body: z.string().min(1).max(4000) });

conversationsRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const rows = await query<RowDataPacket>(
      `SELECT n.id, n.conversation_id, n.operator_id, n.body, n.created_at, o.display_name
         FROM sova_internal_notes n
         JOIN sova_operators o ON o.id = n.operator_id
        WHERE n.conversation_id = ?
        ORDER BY n.created_at ASC`,
      [String(req.params.id)],
    );
    res.json({
      notes: rows.map((row) => ({
        id: idToString(row.id),
        conversationId: idToString(row.conversation_id),
        operatorId: idToString(row.operator_id),
        operatorName: String(row.display_name),
        body: String(row.body),
        createdAt: dateToIso(row.created_at) ?? "",
      })),
    });
  }),
);

conversationsRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    const input = noteSchema.parse(req.body);
    await requireConversationRow(id);
    const result = await execute(
      "INSERT INTO sova_internal_notes (conversation_id, operator_id, body) VALUES (?, ?, ?)",
      [id, operator.operator.id, input.body.trim()],
    );
    await recordEvent(id, "note_added", "operator", operator.operator.id, {});
    res.json({
      note: {
        id: String(result.insertId),
        conversationId: id,
        operatorId: operator.operator.id,
        operatorName: operator.operator.displayName,
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
      },
    });
  }),
);

/** Загрузка изображения оператором (сырое тело запроса). */
conversationsRouter.post(
  "/:id/attachments",
  asyncHandler(async (req, res) => {
    const operator = req.operatorCtx;
    if (!operator) throw errors.unauthorized();
    const id = String(req.params.id);
    await requireConversationRow(id);

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw errors.validation("Ожидается бинарное тело запроса");

    const attachment = await saveAttachment({
      conversationId: id,
      buffer: body,
      fileName: typeof req.query.name === "string" ? req.query.name : "file",
      uploadedBy: "operator",
      uploaderId: operator.operator.id,
    });
    res.json({ attachment });
  }),
);
