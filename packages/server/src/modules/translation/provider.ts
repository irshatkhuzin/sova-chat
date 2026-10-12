/**
 * Интерфейс провайдера перевода. Реализация выбирается по конфигурации.
 * Сейчас реализован перевод той же языковой моделью (llm); добавление DeepL,
 * Google Translate или другого сервиса не требует изменений в логике диалогов.
 */
import type { ChatUsage } from "../ai/openai-client.js";

export interface TranslateRequest {
  productId?: string;
  text: string;
  targetLang: string;
  sourceLang?: string | null;
  /** Название продукта и другие термины, которые нельзя переводить. */
  protectedTerms?: string[];
  /** Короткий контекст (тема диалога) для более точного перевода. */
  context?: string;
}

export interface TranslateResult {
  text: string;
  provider: string;
  model: string | null;
  usage: ChatUsage | null;
  /** Фрагменты, которые модель потеряла и которые пришлось вставить обратно. */
  warnings: string[];
}

export interface DetectLanguageResult {
  lang: string | null;
  confidence: number;
  provider: string;
  model: string | null;
  usage: ChatUsage | null;
}

export interface TranslationProvider {
  readonly name: string;
  translate(req: TranslateRequest): Promise<TranslateResult>;
  detectLanguage(text: string, productId?: string): Promise<DetectLanguageResult>;
}
