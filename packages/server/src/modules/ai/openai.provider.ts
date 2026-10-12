/** Реализация ИИ-помощника поверх OpenAI-совместимого Chat Completions API. */
import type { HandoffReason } from "@sova/shared";
import { moduleLogger } from "../../infra/logger.js";
import { chatCompletion } from "./openai-client.js";
import { buildMessages } from "./prompt.js";
import type { AiDecision, AiGenerateResult, AiProvider, AiReplyRequest } from "./provider.js";

const log = moduleLogger("ai-openai");

const VALID_REASONS: HandoffReason[] = [
  "user_request",
  "low_confidence",
  "no_answer_in_kb",
  "repeated_failure",
  "complaint",
  "technical_failure",
  "rule_match",
];

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";

  async generate(req: AiReplyRequest): Promise<AiGenerateResult> {
    const response = await chatCompletion({
      model: req.model,
      role: "support", productId: req.productId,
      messages: buildMessages(req),
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      json: true,
    });

    const decision = parseDecision(response.content, req);
    return { decision, usage: response.usage, model: response.model };
  }
}

function parseDecision(raw: string, req: AiReplyRequest): AiDecision {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
  } catch {
    log.warn("Модель вернула не-JSON, передаю диалог оператору");
    return {
      action: "handoff",
      reply: "",
      summaryRu: "Ответ ИИ не удалось разобрать, требуется оператор.",
      handoffReason: "low_confidence",
      confidence: 0,
      usedArticleIds: [],
    };
  }

  const actionRaw = String(parsed.action ?? "").toLowerCase();
  if(!['reply','clarify','handoff'].includes(actionRaw))return {action:'handoff',reply:'',summaryRu:'Не удалось выполнить запрос инструмента.',handoffReason:'technical_failure',confidence:0,usedArticleIds:[]};
  const action: AiDecision["action"] =
    actionRaw === "handoff" ? "handoff" : actionRaw === "clarify" ? "clarify" : "reply";

  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const summaryRu =
    typeof parsed.summary_ru === "string" && parsed.summary_ru.trim()
      ? parsed.summary_ru.trim()
      : "Краткое содержание не получено от ИИ.";

  const reasonRaw = typeof parsed.handoff_reason === "string" ? parsed.handoff_reason : null;
  const handoffReason: HandoffReason | null =
    reasonRaw && (VALID_REASONS as string[]).includes(reasonRaw)
      ? (reasonRaw as HandoffReason)
      : null;

  let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(Math.max(confidence, 0), 1);

  const usedArticleIds = Array.isArray(parsed.used_article_ids)
    ? parsed.used_article_ids.map((v) => String(v)).slice(0, 10)
    : [];

  // Пустой ответ при action=reply — считаем, что ИИ не справился.
  if (action !== "handoff" && !reply) {
    return {
      action: "handoff",
      reply: "",
      summaryRu,
      handoffReason: "low_confidence",
      confidence: 0,
      usedArticleIds,
    };
  }

  // Низкая уверенность — передаём оператору, даже если модель решила иначе.
  if (action === "reply" && confidence < req.rules.minConfidence) {
    return {
      action: "handoff",
      reply,
      summaryRu,
      handoffReason: "low_confidence",
      confidence,
      usedArticleIds,
    };
  }

  return {
    action,
    reply,
    summaryRu,
    handoffReason: action === "handoff" ? handoffReason ?? "no_answer_in_kb" : null,
    confidence,
    usedArticleIds,
  };
}

/** Модель иногда оборачивает JSON в ```json … ```. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
