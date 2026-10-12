/**
 * Интерфейс ИИ-помощника. Логика диалогов работает только с этим интерфейсом,
 * поэтому провайдера (OpenAI, другой облачный сервис, локальная модель)
 * можно заменить, не трогая остальную систему.
 */
import type { AiDecisionKind, HandoffReason, HandoffRules } from "@sova/shared";
import type { ChatUsage } from "./openai-client.js";
import type { RelevantArticle } from "../knowledge/knowledge.service.js";
import type { AiImage } from "./media-context.js";
import type { SupportChannelContext } from './channel-context.js';

export interface AiHistoryItem {
  /** user — сообщение пользователя, agent — ответ ИИ или оператора. */
  role: "user" | "agent";
  text: string;
}

export interface AiReplyRequest {
  channel?: SupportChannelContext;
  installationTemplates?: RelevantArticle[];
  images?: AiImage[];
  productId?: string;
  /** Administrative routing metadata. Never use as the customer-facing service name. */
  productName: string;
  productDescription: string | null;
  /** Инструкции ИИ из настроек продукта на выбранном владельцем языке. */
  instructions: string | null;
  /** Язык, на котором нужно ответить пользователю. */
  language: string;
  history: AiHistoryItem[];
  knowledge: RelevantArticle[];
  rules: HandoffRules;
  handoffKeywords: string[];
  clarifyRounds: number;
  maxClarifyRounds: number;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface AiDecision {
  action: AiDecisionKind;
  /** Текст для пользователя на его языке. Для action='handoff' — уведомление о передаче. */
  reply: string;
  /** Краткое содержание обращения на русском для оператора. */
  summaryRu: string;
  handoffReason: HandoffReason | null;
  confidence: number;
  usedArticleIds: string[];
}

export interface AiGenerateResult {
  decision: AiDecision;
  usage: ChatUsage;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generate(req: AiReplyRequest): Promise<AiGenerateResult>;
}
