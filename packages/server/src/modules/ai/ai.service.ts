import { isAgentReady, resolveAgent } from "../ai/settings.service.js";
/**
 * Оркестрация ИИ-ответа: правила продукта, база знаний, вызов провайдера, учёт расходов.
 *
 * Здесь принимается решение «ответить / уточнить / передать оператору».
 * Сервис ничего не отправляет пользователю — это делает воркер после
 * повторной проверки состояния диалога.
 */
import type { HandoffReason } from "@sova/shared";
import { config } from "../../config.js";
import { moduleLogger } from "../../infra/logger.js";
import { findRelevantArticles, findInstallationTemplates } from "../knowledge/knowledge.service.js";
import { loadSupportChannel } from './channel-context.js';
import { queryOne } from '../../infra/db.js';
import { offTopicReply } from './support-scope.js';
import { productRowToDto, type ProductRow } from "../products/product.service.js";
import { checkBudget, recordUsage } from "../usage/usage.service.js";
import { estimateCostUsd } from "./openai-client.js";
import { OpenAiProvider } from "./openai.provider.js";
import { loadMediaContext } from "./media-context.js";
import type { AiDecision, AiHistoryItem, AiProvider, AiReplyRequest, AiGenerateResult } from "./provider.js";

const log = moduleLogger("ai");

let provider: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (!provider) {
    switch (config.ai.provider) {
      case "openai":
      default:
        provider = new OpenAiProvider();
    }
  }
  return provider;
}

export interface AiTurnInput {
  messageId?: string;
  product: ProductRow;
  conversationId: string;
  language: string;
  history: AiHistoryItem[];
  /** Текст последнего сообщения пользователя на русском (если есть) — для поиска по базе знаний. */
  searchText: string;
  clarifyRounds: number;
}

export type AiTurnResult =
  | { kind: "decision"; decision: AiDecision; model: string; promptTokens: number; completionTokens: number }
  | { kind: "handoff"; reason: HandoffReason; summaryRu: string };

/** Локальные правила, которые не требуют обращения к модели. */
export function matchHandoffKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    const needle = kw.trim().toLowerCase();
    return needle.length >= 2 && lower.includes(needle);
  });
}

/** Явная просьба позвать человека на распространённых языках. */
const OPERATOR_REQUEST_PATTERNS: RegExp[] = [
  /(?:^|[^\p{L}])(оператор|человек[ао]?м?|менеджер|поддержк[аиу] человек)/iu,
  /\b(human|real person|live agent|speak to (a )?(person|human|agent|manager)|customer service rep)/i,
  /\b(mensch|mitarbeiter)\b/i,
  /\b(agente humano|persona real|hablar con (un )?(humano|agente|persona))/i,
  /\b(humain|conseiller|parler [àa] (un )?(humain|agent|conseiller))/i,
  /\b(operatore|persona reale)\b/i,
  /\b(insan|yetkili|temsilci)\b/i,
];

export function looksLikeOperatorRequest(text: string): boolean {
  return OPERATOR_REQUEST_PATTERNS.some((re) => re.test(text));
}

export async function runAiTurn(input: AiTurnInput): Promise<AiTurnResult> {
  const product = productRowToDto(input.product);

  if (!product.aiEnabled) {
    return {
      kind: "handoff",
      reason: "rule_match",
      summaryRu: "ИИ отключён в настройках продукта — обращение сразу передано оператору.",
    };
  }

  // Scope is separate from spam: preserve the message, do not increment ban counters or hand off.
  const fixedReply=offTopicReply(input.language);
  if(input.messageId&&fixedReply){
    const scope=await queryOne(`SELECT sc.message_id FROM sova_support_scope sc
      JOIN sova_messages m ON m.id=sc.message_id JOIN sova_conversations c ON c.id=m.conversation_id
      JOIN sova_screening s ON s.message_id=m.id
      WHERE sc.message_id=? AND m.conversation_id=? AND c.product_id=? AND sc.out_of_scope=1
      AND s.verdict='allowed' AND s.reviewed_by IS NULL`,[input.messageId,input.conversationId,product.id]);
    if(scope)return {kind:'decision',decision:{action:'reply',reply:fixedReply,summaryRu:'Посторонняя задача: отправлено напоминание о назначении поддержки.',handoffReason:null,confidence:1,usedArticleIds:[]},model:'support-scope-template',promptTokens:0,completionTokens:0};
  }

  if (!(await isAgentReady("support"))) {
    return {
      kind: "handoff",
      reason: "ai_unavailable",
      summaryRu: "ИИ не настроен (нет ключа провайдера). Обращение передано оператору.",
    };
  }

  const budget = await checkBudget(product.id, {
    daily: product.aiDailyCostLimitUsd,
    monthly: product.aiMonthlyCostLimitUsd,
  });
  if (budget.exceeded) {
    log.warn({ productId: product.id, budget }, "Лимит расходов на ИИ исчерпан");
    return {
      kind: "handoff",
      reason: "ai_budget_exceeded",
      summaryRu: `Исчерпан лимит расходов на ИИ (сегодня $${budget.todayUsd.toFixed(2)} из $${budget.dailyLimitUsd}). Обращение передано оператору.`,
    };
  }

  const lastUserText = [...input.history].reverse().find((h) => h.role === "user")?.text ?? "";

  if (matchHandoffKeywords(lastUserText, product.handoffKeywords) ||
      matchHandoffKeywords(input.searchText, product.handoffKeywords)) {
    return {
      kind: "handoff",
      reason: "rule_match",
      summaryRu: `Сообщение содержит ключевое слово из правил продукта. Текст: «${input.searchText.slice(0, 200)}»`,
    };
  }

  if (looksLikeOperatorRequest(lastUserText) || looksLikeOperatorRequest(input.searchText)) {
    return {
      kind: "handoff",
      reason: "user_request",
      summaryRu: `Пользователь просит связаться с оператором. Текст: «${input.searchText.slice(0, 200)}»`,
    };
  }

  const channel = await loadSupportChannel(product.id,input.conversationId);
  const knowledge = await findRelevantArticles(product.id, input.searchText || lastUserText, 4, input.history, channel?.name);
  const installationTemplates = await findInstallationTemplates(product.id);

  try {
    const images=input.messageId?await loadMediaContext(input.conversationId,input.messageId):[];
    const request:AiReplyRequest = {
      channel,
      installationTemplates,
      images,
      productName: product.name,
      productDescription: product.description,
      instructions: product.aiInstructions,
      language: input.language,
      history: input.history,
      knowledge,
      rules: product.handoffRules,
      handoffKeywords: product.handoffKeywords,
      clarifyRounds: input.clarifyRounds,
      maxClarifyRounds: product.aiMaxClarifyRounds,
      model: product.aiModel || (await resolveAgent("support")).model,
      productId: product.id,
      temperature: product.aiTemperature,
      maxOutputTokens: product.aiMaxOutputTokens,
    };
    let result = await getAiProvider().generate(request);
    const results:AiGenerateResult[]=[result];
    const account=async(call:AiGenerateResult)=>recordUsage({productId:product.id,conversationId:input.conversationId,kind:'reply',provider:getAiProvider().name,model:call.model,usage:call.usage,costUsd:await estimateCostUsd(call.usage,'reply')});
    await account(result);
    // Если база знаний пуста и модель всё же уверенно отвечает — снижаем доверие.
    if (knowledge.length === 0 && result.decision.action === "reply") {
      log.info({ conversationId: input.conversationId }, "Ответ без опоры на базу знаний");
    }

    return {
      kind: "decision",
      decision: result.decision,
      model: result.model,
      promptTokens: results.reduce((sum,r)=>sum+r.usage.promptTokens,0),
      completionTokens: results.reduce((sum,r)=>sum+r.usage.completionTokens,0),
    };
  } catch (err) {
    log.error(
      { conversationId: input.conversationId, err: err instanceof Error ? err.message : String(err) },
      "Вызов ИИ не удался",
    );
    return {
      kind: "handoff",
      reason: "ai_unavailable",
      summaryRu: "ИИ-помощник недоступен (ошибка провайдера). Обращение передано оператору.",
    };
  }
}
