/** Доменные типы, общие для сервера и клиентов. */

export type ConversationStatus = "ai" | "waiting_operator" | "operator" | "closed";

export type MessageAuthorType = "user" | "ai" | "operator" | "system";

export type MessageDeliveryStatus = "pending" | "sent" | "failed";

export type ChannelType = "web" | "android" | "telegram" | "webhook";

export type ReopenPolicy = "reopen_to_ai" | "reopen_to_operator" | "new_conversation";

export type HandoffReason =
  | "user_request"
  | "low_confidence"
  | "no_answer_in_kb"
  | "repeated_failure"
  | "complaint"
  | "technical_failure"
  | "rule_match"
  | "ai_unavailable"
  | "ai_budget_exceeded"
  | "manual";

export const HANDOFF_REASON_RU: Record<HandoffReason, string> = {
  user_request: "Пользователь попросил оператора",
  low_confidence: "ИИ не уверен в ответе",
  no_answer_in_kb: "Нет ответа в базе знаний",
  repeated_failure: "Проблема не решилась за несколько попыток",
  complaint: "Жалоба",
  technical_failure: "Серьёзный технический сбой",
  rule_match: "Сработало правило продукта",
  ai_unavailable: "ИИ недоступен",
  ai_budget_exceeded: "Исчерпан лимит расходов на ИИ",
  manual: "Оператор взял диалог вручную",
};

export const CONVERSATION_STATUS_RU: Record<ConversationStatus, string> = {
  ai: "Отвечает ИИ",
  waiting_operator: "Ожидает оператора",
  operator: "Отвечает оператор",
  closed: "Закрыт",
};

/** Вложение (в первой версии — изображения). */
export interface AttachmentDto {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  url: string;
  width?: number | null;
  height?: number | null;
}

/** Сообщение в том виде, в котором его видит клиент (виджет/SDK). */
export interface ClientMessageDto {
  id: string;
  seq: number;
  /** Для клиента оператор и ИИ неразличимы: оба приходят как "agent". */
  author: "user" | "agent" | "system";
  text: string;
  createdAt: string;
  clientMsgId?: string | null;
  attachments?: AttachmentDto[];
}

/** Сообщение в том виде, в котором его видит оператор в панели. */
export interface PanelMessageDto {
  isInternal?: boolean;
  /** First server-confirmed display in the customer's active chat. */
  clientReadAt?: string | null;
  id: string;
  conversationId: string;
  seq: number;
  authorType: MessageAuthorType;
  authorOperatorId?: string | null;
  authorName?: string | null;
  /** Исходный текст как он был написан автором. Никогда не изменяется. */
  originalText: string;
  originalLang: string | null;
  /** Русский перевод для чтения оператором (null, если оригинал уже на русском). */
  translationRu: string | null;
  /** Текст, фактически отправленный пользователю (для сообщений оператора). */
  outboundText: string | null;
  outboundLang: string | null;
  translationStatus: "none" | "pending" | "ok" | "failed";
  translationError: string | null;
  deliveryStatus: MessageDeliveryStatus;
  failureReason: string | null;
  aiMeta: AiMessageMeta | null;
  attachments: AttachmentDto[];
  createdAt: string;
}

export interface AiMessageMeta {
  model?: string;
  decision?: AiDecisionKind;
  confidence?: number;
  usedArticleIds?: string[];
  promptTokens?: number;
  completionTokens?: number;
}

export type AiDecisionKind = "reply" | "clarify" | "handoff";

export interface ConversationListItemDto {
  id: string;
  productId: string;
  productName: string;
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  endUserId: string;
  endUserName: string;
  endUserIsVerified: boolean;
  status: ConversationStatus;
  language: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  handoffReason: HandoffReason | null;
  assignedOperatorId: string | null;
  createdAt: string;
}

export interface ConversationDetailDto extends ConversationListItemDto {
  handoffSummaryRu: string | null;
  handoffAt: string | null;
  stateVersion: number;
  closedAt: string | null;
  previousConversationId: string | null;
  endUser: EndUserDto;
}

export interface EndUserDto {
  isBlocked: boolean;
  blockedUntil: string | null;
  blockedReason: string | null;
  id: string;
  productId: string;
  externalId: string | null;
  isVerified: boolean;
  displayName: string | null;
  email: string | null;
  language: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  meta: Record<string, unknown>;
}

export interface InternalNoteDto {
  id: string;
  conversationId: string;
  operatorId: string;
  operatorName: string;
  body: string;
  createdAt: string;
}

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  aiEnabled: boolean;
  aiInstructions: string | null;
  aiModel: string | null;
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxClarifyRounds: number;
  handoffKeywords: string[];
  handoffRules: HandoffRules;
  defaultLanguage: string;
  reopenPolicy: ReopenPolicy;
  aiDailyCostLimitUsd: number;
  aiMonthlyCostLimitUsd: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffRules {
  /** Передавать оператору при обнаружении жалобы. */
  onComplaint: boolean;
  /** Передавать при сообщении о серьёзном техническом сбое. */
  onTechnicalFailure: boolean;
  /** Передавать при вопросах об оплате, возврате, состоянии аккаунта. */
  onBillingOrAccount: boolean;
  /** Передавать, если уверенность модели ниже порога (0..1). */
  minConfidence: number;
  /** Произвольные правила: «если пользователь пишет про X — передавай». */
  custom: string[];
}

export const DEFAULT_HANDOFF_RULES: HandoffRules = {
  onComplaint: true,
  onTechnicalFailure: true,
  onBillingOrAccount: true,
  minConfidence: 0.55,
  custom: [],
};

export interface ChannelDto {
  id: string;
  productId: string;
  type: ChannelType;
  name: string;
  publicId: string;
  allowedOrigins: string[];
  settings: WidgetSettings;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Секрет подписи возвращается только при создании или явной перегенерации. */
  authSecret?: string;
}

export interface WidgetSettings {
  title: string;
  subtitle: string;
  greeting: string;
  /** Текст, показываемый при передаче оператору (переводится автоматически). */
  handoffNotice: string;
  offlineNotice: string;
  primaryColor: string;
  position: "right" | "left";
  offsetX: number;
  offsetY: number;
  locale: string;
  showLauncherLabel: boolean;
  launcherLabel: string;
  allowAttachments: boolean;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  title: "Поддержка",
  subtitle: "Обычно отвечаем за пару минут",
  greeting: "Здравствуйте! Опишите вопрос — постараемся помочь.",
  handoffNotice: "Передаю обращение специалисту поддержки. Он ответит в этом же чате.",
  offlineNotice: "Сообщение сохранено. Мы ответим здесь же, как только сможем.",
  primaryColor: "#2f6df6",
  position: "right",
  offsetX: 24,
  offsetY: 24,
  locale: "auto",
  showLauncherLabel: false,
  launcherLabel: "Чат с поддержкой",
  allowAttachments: true,
};

export interface KnowledgeArticleDto {
  id: string;
  productId: string;
  title: string;
  body: string;
  kind: "article" | "faq";
  lang: string;
  tags: string[];
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorDto {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "operator";
  isActive: boolean;
  telegramUserId: string | null;
  createdAt: string;
}

export interface UsageSummaryDto {
  productId: string;
  productName: string;
  todayUsd: number;
  monthUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  todayCalls: number;
  monthCalls: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
