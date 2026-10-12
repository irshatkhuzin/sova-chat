import { isAgentReady, resolveAgent } from "../ai/settings.service.js";
/**
 * Сервис переводов: кэш в MySQL, определение языка, единая точка вызова провайдера.
 *
 * Оригинал сообщения не изменяется никогда. Перевод хранится отдельной строкой
 * и переиспользуется, поэтому повторное открытие переписки ничего не стоит.
 */
import type { RowDataPacket } from "mysql2/promise";
import { normalizeLanguage } from "@sova/shared";
import { config } from "../../config.js";
import { execute, queryOne } from "../../infra/db.js";
import { moduleLogger } from "../../infra/logger.js";
import { estimateCostUsd } from "../ai/openai-client.js";
import { recordUsage } from "../usage/usage.service.js";
import { LlmTranslationProvider } from "./llm-translation.provider.js";
import type { TranslationProvider } from "./provider.js";
import { isLanguageNeutral } from "./protect.js";

const log = moduleLogger("translation");

let provider: TranslationProvider | null = null;

export function getTranslationProvider(): TranslationProvider {
  if (!provider) {
    switch (config.translation.provider) {
      case "llm":
      default:
        provider = new LlmTranslationProvider();
    }
  }
  return provider;
}

export const OPERATOR_LANGUAGE = config.translation.operatorLanguage;

/** Быстрое определение языка по письменности. Возвращает null, если неоднозначно. */
export function detectByScript(text: string): { lang: string; confidence: number } | null {
  const sample = text.slice(0, 500);
  const counts = {
    cyrillic: (sample.match(/[Ѐ-ӿ]/g) ?? []).length,
    latin: (sample.match(/[A-Za-z]/g) ?? []).length,
    arabic: (sample.match(/[؀-ۿ]/g) ?? []).length,
    hebrew: (sample.match(/[֐-׿]/g) ?? []).length,
    han: (sample.match(/[一-鿿]/g) ?? []).length,
    hiragana: (sample.match(/[぀-ヿ]/g) ?? []).length,
    hangul: (sample.match(/[가-힯]/g) ?? []).length,
    thai: (sample.match(/[฀-๿]/g) ?? []).length,
    greek: (sample.match(/[Ͱ-Ͽ]/g) ?? []).length,
    devanagari: (sample.match(/[ऀ-ॿ]/g) ?? []).length,
    armenian: (sample.match(/[԰-֏]/g) ?? []).length,
    georgian: (sample.match(/[Ⴀ-ჿ]/g) ?? []).length,
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < 3) return null;

  if (counts.hiragana > 0) return { lang: "ja", confidence: 0.95 };
  if (counts.hangul > 0) return { lang: "ko", confidence: 0.95 };
  if (counts.han > total * 0.3) return { lang: "zh", confidence: 0.9 };
  if (counts.thai > total * 0.3) return { lang: "th", confidence: 0.95 };
  if (counts.hebrew > total * 0.3) return { lang: "he", confidence: 0.95 };
  if (counts.arabic > total * 0.3) return { lang: "ar", confidence: 0.85 };
  if (counts.greek > total * 0.3) return { lang: "el", confidence: 0.9 };
  if (counts.devanagari > total * 0.3) return { lang: "hi", confidence: 0.85 };
  if (counts.armenian > total * 0.3) return { lang: "hy", confidence: 0.95 };
  if (counts.georgian > total * 0.3) return { lang: "ka", confidence: 0.95 };

  if (counts.cyrillic > total * 0.5) {
    if (/[іїєґ]/i.test(sample)) return { lang: "uk", confidence: 0.85 };
    if (/[ў]/i.test(sample)) return { lang: "be", confidence: 0.8 };
    if (/[ҳқғӯҷ]/i.test(sample)) return { lang: "tg", confidence: 0.75 };
    return { lang: "ru", confidence: 0.85 };
  }

  // Латиница — язык по письменности не определить, нужен провайдер.
  return null;
}

export interface DetectOptions {
  hint?: string | null;
  productId?: string;
  conversationId?: string;
}

/**
 * Определяет язык сообщения.
 * Порядок: письменность → провайдер → подсказка браузера → язык продукта.
 */
export async function detectLanguage(
  text: string,
  options: DetectOptions = {},
): Promise<{ lang: string | null; source: "script" | "provider" | "hint" | "unknown" }> {
  const byScript = detectByScript(text);
  if (byScript && byScript.confidence >= 0.85) {
    return { lang: byScript.lang, source: "script" };
  }

  if (await isAgentReady("translation") && text.trim().length >= 2) {
    try {
      const result = await getTranslationProvider().detectLanguage(text, options.productId);
      if (result.lang && result.confidence >= 0.8 && (result.lang !== "ru" || /\p{Script=Cyrillic}/u.test(text))) {
        if (result.usage && options.productId) {
          await recordUsage({
            productId: options.productId,
            conversationId: options.conversationId ?? null,
            kind: "detect",
            provider: result.provider,
            model: result.model ?? "unknown",
            usage: result.usage,
            costUsd: await estimateCostUsd(result.usage, "translate"),
          });
        }
        return { lang: result.lang, source: "provider" };
      }
    } catch (err) {
      log.warn({ err: String(err) }, "Определение языка провайдером не удалось");
    }
  }

  const hint = normalizeLanguage(options.hint ?? null);
  if (hint && hint !== "ru") return { lang: hint, source: "hint" };

  return { lang: byScript?.lang ?? null, source: byScript ? "script" : "unknown" };
}

export interface TranslationRecord {
  status: "pending" | "ok" | "failed";
  text: string | null;
  error: string | null;
}

export async function getStoredTranslation(
  messageId: string,
  targetLang: string,
): Promise<TranslationRecord | null> {
  const row = await queryOne<RowDataPacket>(
    "SELECT status, text, error FROM sova_message_translations WHERE message_id = ? AND target_lang = ? LIMIT 1",
    [messageId, targetLang],
  );
  if (!row) return null;
  return {
    status: row.status as TranslationRecord["status"],
    text: row.text as string | null,
    error: row.error as string | null,
  };
}

async function upsertTranslation(
  messageId: string,
  targetLang: string,
  patch: {
    status: "pending" | "ok" | "failed";
    text?: string | null;
    error?: string | null;
    provider: string;
    model?: string | null;
  },
): Promise<void> {
  await execute(
    `INSERT INTO sova_message_translations (message_id, target_lang, text, provider, model, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       text = VALUES(text), provider = VALUES(provider), model = VALUES(model),
       status = VALUES(status), error = VALUES(error)`,
    [
      messageId,
      targetLang,
      patch.text ?? null,
      patch.provider,
      patch.model ?? null,
      patch.status,
      patch.error?.slice(0, 250) ?? null,
    ],
  );
}

export interface EnsureTranslationInput {
  messageId: string;
  text: string;
  sourceLang: string | null;
  targetLang: string;
  productId: string;
  conversationId: string;
  protectedTerms?: string[];
  /** Переводить заново, даже если перевод уже есть (кнопка «Повторить»). */
  force?: boolean;
}

export interface EnsureTranslationResult {
  status: "ok" | "failed" | "skipped";
  text: string | null;
  error: string | null;
}

/**
 * Возвращает перевод сообщения, переиспользуя сохранённый.
 * Если язык оригинала совпадает с целевым — перевод не нужен (skipped).
 */
export async function ensureTranslation(
  input: EnsureTranslationInput,
): Promise<EnsureTranslationResult> {
  const target = normalizeLanguage(input.targetLang);
  if (!target) return { status: "skipped", text: null, error: null };

  const source = normalizeLanguage(input.sourceLang);
  if (source && source === target) {
    return { status: "skipped", text: null, error: null };
  }

  if (isLanguageNeutral(input.text)) {
    await upsertTranslation(input.messageId, target, { status: "ok", text: input.text, provider: "identity" });
    return { status: "ok", text: input.text, error: null };
  }

  if (!input.force) {
    const stored = await getStoredTranslation(input.messageId, target);
    if (stored?.status === "ok" && stored.text) {
      return { status: "ok", text: stored.text, error: null };
    }
  }

  if (!(await isAgentReady("translation"))) {
    const message = "Перевод недоступен: ключ провайдера не настроен";
    await upsertTranslation(input.messageId, target, {
      status: "failed",
      error: message,
      provider: config.translation.provider,
    });
    return { status: "failed", text: null, error: message };
  }

  await upsertTranslation(input.messageId, target, {
    status: "pending",
    provider: config.translation.provider,
  });

  try {
    const result = await getTranslationProvider().translate({
      text: input.text,
      productId: input.productId,
      targetLang: target,
      sourceLang: source,
      protectedTerms: input.protectedTerms ?? [],
    });

    await upsertTranslation(input.messageId, target, {
      status: "ok",
      text: result.text,
      provider: result.provider,
      model: result.model,
      error: result.warnings.length > 0 ? result.warnings.join("; ") : null,
    });

    if (result.usage) {
      await recordUsage({
        productId: input.productId,
        conversationId: input.conversationId,
        kind: "translate",
        provider: result.provider,
        model: result.model ?? "unknown",
        usage: result.usage,
        costUsd: await estimateCostUsd(result.usage, "translate"),
      });
    }

    return { status: "ok", text: result.text, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ messageId: input.messageId, target, err: message }, "Перевод не выполнен");
    await upsertTranslation(input.messageId, target, {
      status: "failed",
      error: message,
      provider: config.translation.provider,
    });
    return { status: "failed", text: null, error: message };
  }
}
