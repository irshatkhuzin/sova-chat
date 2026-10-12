/**
 * Защита фрагментов, которые нельзя изменять при переводе:
 * ссылки, e-mail, код, идентификаторы, суммы, названия продуктов.
 *
 * Фрагменты заменяются на маркеры ⟦0⟧, ⟦1⟧ … Переводится текст с маркерами,
 * затем маркеры возвращаются на место. Так исключается «творческий» перевод
 * номера заказа или ссылки.
 */

export interface MaskResult {
  masked: string;
  fragments: string[];
}

const PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // блоки кода
  /`[^`\n]+`/g, // inline-код
  /\bSova\b/g,
  /\bhttps?:\/\/[^\s<>"')]+/gi, // ссылки
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // e-mail
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // UUID
  /#\d{2,}/g, // номера обращений
  /\b[A-Z]{2,}[-_]?\d{3,}\b/g, // артикулы, ORDER-12345
  /\b\d[\d\s.,]*\s?(?:₽|руб\.?|USD|EUR|\$|€|£)\b/gi, // суммы с валютой
  /\b(?:\+?\d[\d\-\s()]{7,}\d)\b/g, // телефоны
];

/** Names, links, identifiers and emoji do not establish a conversation language. */
export function isLanguageNeutral(text: string): boolean {
  if (/^\s*\((?:вложение|attachment)\)\s*$/iu.test(text)) return true;
  const { masked } = maskProtected(text);
  return !/\p{L}/u.test(masked.replace(/⟦\d+⟧/g, "").replace(/\bUID\b/gi, ""));
}

export function isShortReply(text: string): boolean {
  return text.trim().length <= 60 && (text.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 3;
}

export function maskProtected(text: string, extraTerms: string[] = []): MaskResult {
  const fragments: string[] = [];
  let masked = text;

  const patterns = [...PATTERNS];
  for (const term of extraTerms) {
    const trimmed = term.trim();
    if (trimmed.length < 2) continue;
    patterns.push(new RegExp(escapeRegExp(trimmed), "gi"));
  }

  for (const pattern of patterns) {
    masked = masked.replace(pattern, (match) => {
      // Не маскируем повторно уже вставленные маркеры.
      if (/^⟦\d+⟧$/.test(match)) return match;
      const index = fragments.length;
      fragments.push(match);
      return `⟦${index}⟧`;
    });
  }

  return { masked, fragments };
}

export interface RestoreResult {
  text: string;
  /** Маркеры, которые модель потеряла. */
  missing: number[];
}

export function restoreProtected(translated: string, fragments: string[]): RestoreResult {
  const missing: number[] = [];
  let text = translated;

  fragments.forEach((fragment, index) => {
    // Модель может слегка исказить маркер — допускаем пробелы внутри.
    const marker = new RegExp(`⟦\\s*${index}\\s*⟧`, "g");
    if (!marker.test(text)) {
      missing.push(index);
      return;
    }
    text = text.replace(new RegExp(`⟦\\s*${index}\\s*⟧`, "g"), () => fragment);
  });

  return { text, missing };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
