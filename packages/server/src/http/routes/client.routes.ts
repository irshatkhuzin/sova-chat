import { saveEnvironment } from "../../modules/users/client-environment.service.js";
import { localizeChannel, saveWidgetLanguage } from "../../modules/channels/localization.service.js";
/**
 * API клиента: виджет на сайте и Android SDK.
 *
 * Публичный идентификатор канала позволяет только создать сессию.
 * Любая работа с перепиской требует session_token, выданного сервером.
 */
import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_WIDGET_SETTINGS,
  normalizeLanguage,
  type ClientSessionResponse,
  type WidgetSettings,
} from "@sova/shared";
import { config } from "../../config.js";
import { idToString, parseJson, execute } from "../../infra/db.js";
import { errors } from "../../infra/errors.js";
import { moduleLogger } from "../../infra/logger.js";
import {
  createClientSession,
  revokeClientSession,
} from "../../modules/auth/client-session.service.js";
import {
  getChannelRowByPublicId,
  isOriginAllowed,
  channelRowToDto,
  type ChannelRow,
} from "../../modules/channels/channel.service.js";
import {
  getLatestConversation,
  resolveConversationForIncoming,
  requireConversationRow,
  type ConversationRow,
} from "../../modules/conversations/conversation.service.js";
import { saveAttachment } from "../../modules/files/file.service.js";
import {
  appendMessage,
  buildMessageDtos,
  listMessagesForClient,
} from "../../modules/messages/message.service.js";
import { getProductRow, productRowToDto } from "../../modules/products/product.service.js";
import type { EndUserRow } from "../../modules/users/end-user.service.js";
import { enqueueInbound } from "../../queue/queues.js";
import { deliverMessage, publishConversationUpdate } from "../../pipeline/delivery.js";
import {
  asyncHandler,
  clientIp,
  rateLimit,
  requireClientSession,
} from "../middleware.js";

const log = moduleLogger("client-api");
import { assertUserMaySend, guardMessageBurst } from '../../modules/users/moderation.service.js';
import { activityError, agentIsTyping, setPresence, setTyping } from '../../realtime/activity.js';
import { recordClientReads } from '../../modules/messages/read-receipts.service.js';

export const clientRouter = Router();

const sessionSchema = z.object({
  channelPublicId: z.string().min(8).max(64),
  // Kotlin serialization sends explicit null for absent optional fields.
  visitorKey: z.string().max(64).nullish().transform(v=>v??undefined),
  authToken: z.string().max(4096).nullish().transform(v=>v??undefined),
  languageHint: z.string().max(32).nullish().transform(v=>v??undefined),
  meta: z.record(z.string()).nullish().transform(v=>v??undefined),
});

const messageSchema = z.object({
  clientMsgId: z.string().min(1).max(64),
  text: z.string().max(config.limits.maxMessageLength),
  attachmentIds: z.array(z.string().uuid()).max(3).optional(),
  languageHint: z.string().max(32).optional(),
});

/** Публичные настройки канала — нужны виджету до создания сессии. */
clientRouter.get(
  "/config",
  rateLimit({ name: "client-config", limit: 120, windowSec: 60 }),
  asyncHandler(async (req, res) => {
    const publicId = String(req.query.channel ?? "");
    const channel = await getChannelRowByPublicId(publicId);
    if (!channel || channel.is_active !== 1) throw errors.notFound("Канал не найден");

    const product = await getProductRow(idToString(channel.product_id));
    const localized = await localizeChannel(channel, String(req.query.lang || req.headers['accept-language'] || 'en'));

    res.json({
      channelId: channel.public_id,
      productName: product ? product.name : "",
      ...localized,
      socketPath: "/socket.io",
      serverUrl: config.publicUrl,
    });
  }),
);

clientRouter.post(
  "/session",
  rateLimit({
    name: "client-session",
    limit: config.limits.clientSessionsPerHour,
    windowSec: 3600,
  }),
  asyncHandler(async (req, res) => {
    const input = sessionSchema.parse(req.body);

    const channel = await getChannelRowByPublicId(input.channelPublicId);
    if (!channel || channel.is_active !== 1) throw errors.notFound("Канал не найден");

    assertOriginAllowed(channel, req.headers.origin);

    const session = await createClientSession({
      channel,
      visitorKey: input.visitorKey,
      authToken: input.authToken,
      languageHint: input.languageHint,
      ip: clientIp(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });

    const product = await getProductRow(idToString(channel.product_id));
    const conversation = await getLatestConversation(
      idToString(session.endUser.id),
      idToString(channel.id),
    );

    await saveEnvironment(session.sessionId,input.languageHint||req.headers['accept-language']).catch(()=>undefined);
    const localized = await localizeChannel(channel, input.languageHint || req.headers['accept-language']);
    await saveWidgetLanguage(channel.id, session.endUser.id, localized.settings.locale);

    const response: ClientSessionResponse = {
      sessionToken: session.sessionToken,
      visitorKey: session.visitorKey,
      expiresAt: session.expiresAt.toISOString(),
      endUser: {
        id: idToString(session.endUser.id),
        displayName: session.endUser.display_name,
        isVerified: session.endUser.is_verified === 1,
        language: session.endUser.language,
      },
      conversation: conversation
        ? {
            id: idToString(conversation.id),
            status: conversation.status,
            lastSeq: Number(conversation.last_seq),
          }
        : { id: "", status: "ai", lastSeq: 0 },
      widget: { ...localized, productName: product ? product.name : "" },
      socketPath: "/socket.io",
    };

    res.json(response);
  }),
);

clientRouter.post(
  "/session/logout",
  requireClientSession,
  asyncHandler(async (req, res) => {
    if (req.clientToken) await revokeClientSession(req.clientToken);
    res.json({ ok: true });
  }),
);

/** История переписки. afterSeq позволяет добрать пропущенное после переподключения. */
clientRouter.get(
  "/messages",
  requireClientSession,
  rateLimit({ name: "client-history", limit: 120, windowSec: 60 }),
  asyncHandler(async (req, res) => {
    const ctx = req.clientCtx;
    if (!ctx) throw errors.unauthorized();

    const presenceId = z.string().uuid().safeParse(req.query.presenceId);
    if (presenceId.success) await setPresence(idToString(ctx.endUser.id), `sdk:${ctx.sessionId}:${presenceId.data}`, 'online').catch(activityError);
    if (typeof req.query.uiLanguage === "string" && req.query.uiLanguage.length <= 32) {
      await saveWidgetLanguage(ctx.channel.id, ctx.endUser.id, req.query.uiLanguage);
    }
    const conversation = await getLatestConversation(
      idToString(ctx.endUser.id),
      idToString(ctx.channel.id),
    );
    if (!conversation) {
      res.json({ conversationId: null, status: "ai", messages: [], lastSeq: 0 });
      return;
    }

    const afterSeq = Number(req.query.afterSeq ?? 0);
    const messages = await listMessagesForClient(
      idToString(conversation.id),
      conversation.language,
      { afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0, limit: 200 },
    );

    res.json({
      conversationId: idToString(conversation.id),
      status: conversation.status,
      lastSeq: Number(conversation.last_seq),
      language: conversation.language,
      messages,
      agentTyping: conversation.status !== 'closed' && await agentIsTyping(idToString(conversation.id)).catch(() => false),
    });
  }),
);

/** Native clients without a socket: typing and lifecycle, never message contents. */
clientRouter.post('/read', requireClientSession,
  rateLimit({ name: 'client-read', limit: 120, windowSec: 60, keyFn: req => req.clientCtx?.sessionId ?? clientIp(req) }),
  asyncHandler(async (req, res) => {
    const ctx = req.clientCtx;
    if (!ctx) throw errors.unauthorized();
    const input = z.object({ messageIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(100) }).parse(req.body);
    const receipts = await recordClientReads(idToString(ctx.endUser.id), idToString(ctx.channel.id), input.messageIds);
    res.json({ receipts });
  }));

/** Native clients without a socket: typing and lifecycle, never message contents. */
clientRouter.post('/activity', requireClientSession,
  rateLimit({ name: 'client-activity', limit: 90, windowSec: 60, keyFn: req => req.clientCtx?.sessionId ?? clientIp(req) }),
  asyncHandler(async (req, res) => {
    const ctx = req.clientCtx;
    if (!ctx) throw errors.unauthorized();
    const input = z.object({ connectionId: z.string().uuid(), online: z.boolean(), typing: z.boolean().optional() }).parse(req.body);
    const source = `sdk:${ctx.sessionId}:${input.connectionId}`;
    await setPresence(idToString(ctx.endUser.id), source, input.online ? 'online' : 'offline');
    const conversation = await getLatestConversation(idToString(ctx.endUser.id), idToString(ctx.channel.id));
    if (conversation && input.typing !== undefined) await setTyping(idToString(conversation.id), 'user', source, input.online && input.typing && conversation.status !== 'closed');
    res.json({ ok: true });
  }));

clientRouter.post(
  "/messages",
  requireClientSession,
  rateLimit({
    name: "client-messages",
    limit: config.limits.clientMessagesPerMin,
    windowSec: 60,
    keyFn: (req) => req.clientCtx?.sessionId ?? clientIp(req),
  }),
  asyncHandler(async (req, res) => {
    const ctx = req.clientCtx;
    if (!ctx) throw errors.unauthorized();

    const input = messageSchema.parse(req.body);
    await assertUserMaySend(idToString(ctx.endUser.id));
    await guardMessageBurst(idToString(ctx.endUser.id),input.clientMsgId);
    const text = input.text.trim();
    const hasAttachments = (input.attachmentIds ?? []).length > 0;
    if (!text && !hasAttachments) throw errors.validation("Пустое сообщение");

    const conversation = await resolveConversationForClient(ctx.endUser, ctx.channel, input.languageHint ?? null);

    const appended = await appendMessage({
      conversationId: idToString(conversation.id),
      authorType: "user",
      text: text || "(вложение)",
      originalLang: null,
      clientMsgId: input.clientMsgId,
      attachmentIds: input.attachmentIds,
      deferSummary: true,
    });

    if (!appended.message) throw errors.internal("Сообщение не сохранено");

    const messageId = idToString(appended.message.id);

    if (!appended.duplicate) {
      // Сначала сохранили, теперь отдаём в фоновую обработку.
      await enqueueInbound({
        conversationId: idToString(conversation.id),
        messageId,
        languageHint: input.languageHint ?? null,
      });

    }

    const current = await requireConversationRow(idToString(conversation.id));
    const dtos = await buildMessageDtos(messageId, current.language);

    res.json({
      conversationId: idToString(conversation.id),
      conversationStatus: current.status,
      duplicate: appended.duplicate,
      message: dtos.client,
    });
  }),
);

/**
 * Загрузка изображения. Файл передаётся «сырым» телом запроса —
 * так не нужен парсер multipart, а тип определяется по содержимому.
 */
clientRouter.post(
  "/attachments",
  requireClientSession,
  rateLimit({
    name: "client-uploads",
    limit: 20,
    windowSec: 300,
    keyFn: (req) => req.clientCtx?.sessionId ?? clientIp(req),
  }),
  asyncHandler(async (req, res) => {
    const ctx = req.clientCtx;
    if (!ctx) throw errors.unauthorized();

    const body = req.body as Buffer;
    await assertUserMaySend(idToString(ctx.endUser.id));
    const channelSettings={...DEFAULT_WIDGET_SETTINGS,...parseJson<Partial<WidgetSettings>>(ctx.channel.settings,{})};
    if(!channelSettings.allowAttachments)throw errors.forbidden("Вложения отключены для этого канала");
    if (!Buffer.isBuffer(body)) throw errors.validation("Ожидается бинарное тело запроса");

    const conversation = await resolveConversationForClient(ctx.endUser, ctx.channel, null);
    const fileName = typeof req.query.name === "string" ? req.query.name : "screenshot";

    const attachment = await saveAttachment({
      conversationId: idToString(conversation.id),
      buffer: body,
      fileName,
      uploadedBy: "user",
      uploaderId: idToString(ctx.endUser.id),
    });

    res.json({ attachment });
  }),
);

function assertOriginAllowed(channel: ChannelRow, origin: string | undefined): void {
  if (channel.type !== "web") return;
  const dto = channelRowToDto(channel);
  if (!isOriginAllowed(dto.allowedOrigins, origin)) {
    log.warn({ channelId: dto.id, origin }, "Запрос с неразрешённого домена");
    throw errors.forbidden("Домен не разрешён для этого канала");
  }
}

/**
 * Диалог, в который попадёт входящее сообщение.
 * Если прошлый диалог закрыт — применяется политика продукта reopen_policy.
 */
async function resolveConversationForClient(
  endUser: EndUserRow,
  channel: ChannelRow,
  languageHint: string | null,
): Promise<ConversationRow> {
  const product = await getProductRow(idToString(channel.product_id));
  if (!product) throw errors.notFound("Продукт не найден");
  const dto = productRowToDto(product);

  return resolveConversationForIncoming({
    endUser,
    channel,
    reopenPolicy: dto.reopenPolicy,
    languageHint: normalizeLanguage(languageHint),
  });
}
