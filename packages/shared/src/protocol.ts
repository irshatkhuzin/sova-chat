/**
 * Контракт realtime-канала (Socket.IO) и REST.
 * Имена событий вынесены в константы, чтобы сервер, панель, виджет и Android SDK
 * ссылались на один и тот же список.
 */

import type {
  ClientMessageDto,
  ConversationListItemDto,
  ConversationStatus,
  HandoffReason,
  PanelMessageDto,
} from "./types.js";

export const API_PREFIX = "/api/v1";

/** Пространства имён Socket.IO. */
export const CLIENT_NAMESPACE = "/client";
export const PANEL_NAMESPACE = "/panel";

/** События, которые сервер отправляет клиенту (виджет, SDK). */
export const ClientEvents = {
  Ready: "ready",
  Message: "message",
  MessageAck: "message:ack",
  Typing: "typing",
  ConversationStatus: "conversation:status",
  Error: "error",
} as const;

/** События, которые клиент отправляет серверу. */
export const ClientCommands = {
  Sync: "sync",
  Typing: "typing",
  Presence: "presence",
} as const;

/** События, которые сервер отправляет в панель оператора. */
export const PanelEvents = {
  ReadReceipt: "message:read",
  Presence: "presence",
  Ready: "ready",
  Message: "message",
  ConversationUpdated: "conversation:updated",
  ConversationCreated: "conversation:created",
  Handoff: "handoff",
  Typing: "typing",
  MessageUpdated: "message:updated",
  Error: "error",
} as const;

/** Команды панели. */
export const PanelCommands = {
  Presence: "presence:sync",
  SubscribeConversation: "conversation:subscribe",
  UnsubscribeConversation: "conversation:unsubscribe",
  Typing: "typing",
} as const;

export interface UserPresence {
  endUserId: string;
  state: 'online' | 'away' | 'offline';
  /** Approximate last connection activity, retained for one day. */
  lastSeenAt: string | null;
}

export interface MessageReadReceipt {
  messageId: string;
  readAt: string;
}

export interface ClientReadyPayload {
  conversationId: string;
  status: ConversationStatus;
  language: string | null;
  lastSeq: number;
}

export interface ClientMessagePayload {
  conversationId: string;
  message: ClientMessageDto;
}

export interface ClientStatusPayload {
  conversationId: string;
  status: ConversationStatus;
}

export interface ClientSyncRequest {
  conversationId: string;
  lastSeq: number;
}

export interface PanelMessagePayload {
  conversationId: string;
  message: PanelMessageDto;
  conversation: ConversationListItemDto;
}

export interface PanelHandoffPayload {
  conversationId: string;
  reason: HandoffReason;
  reasonRu: string;
  summaryRu: string;
  conversation: ConversationListItemDto;
}

export interface PanelConversationPayload {
  conversation: ConversationListItemDto;
}

export interface PanelMessageUpdatedPayload {
  conversationId: string;
  message: PanelMessageDto;
}

/** Тело запроса на создание сессии клиента. */
export interface ClientSessionRequest {
  channelPublicId: string;
  /** Локально сохранённый ключ анонимного посетителя (если есть). */
  visitorKey?: string;
  /** Токен, подписанный вашим бекендом, — подтверждает личность пользователя. */
  authToken?: string;
  /** Подсказка языка из браузера/устройства. */
  languageHint?: string;
  /** Произвольные метаданные (страница, версия приложения). */
  meta?: Record<string, string>;
}

export interface ClientSessionResponse {
  sessionToken: string;
  visitorKey: string;
  expiresAt: string;
  endUser: {
    id: string;
    displayName: string | null;
    isVerified: boolean;
    language: string | null;
  };
  /** Пустой id означает, что диалога ещё нет — он создастся при первом сообщении. */
  conversation: {
    id: string;
    status: ConversationStatus;
    lastSeq: number;
  };
  widget: {
    settings: import("./types.js").WidgetSettings;
    strings?: import('./widget-i18n.js').WidgetStrings;
    localization?: import('./widget-localization.js').WidgetLocalization;
    productName: string;
  };
  socketPath: string;
}

export interface SendClientMessageRequest {
  clientMsgId: string;
  text: string;
  attachmentIds?: string[];
  languageHint?: string;
}

export interface SendClientMessageResponse {
  /** Диалог, в который попало сообщение (может быть новым после закрытия прежнего). */
  conversationId: string;
  message: ClientMessageDto | null;
  conversationStatus: ConversationStatus;
  /** true — сообщение с таким clientMsgId уже было принято ранее. */
  duplicate: boolean;
}

export interface SendOperatorMessageRequest {
  /** Текст на русском языке. Перевод выполняет сервер. */
  textRu: string;
  clientMsgId?: string;
  attachmentIds?: string[];
}

/** Коды ошибок API. */
export const ErrorCodes = {
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  NotFound: "not_found",
  Validation: "validation_error",
  RateLimited: "rate_limited",
  Conflict: "conflict",
  PayloadTooLarge: "payload_too_large",
  UnsupportedMedia: "unsupported_media_type",
  Internal: "internal_error",
  AiUnavailable: "ai_unavailable",
  TranslationFailed: "translation_failed",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
