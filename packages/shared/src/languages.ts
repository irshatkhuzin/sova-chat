/** Работа с кодами языков. Общая для сервера, панели и виджета. */

export const OPERATOR_LANGUAGE = "ru";

/** Языки, для которых есть локализация интерфейса виджета. */
export const WIDGET_LOCALES = ["ru", "en", "de", "fr", "es", "pt", "it", "tr", "uk", "zh"] as const;

export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

const LANGUAGE_NAMES_RU: Record<string, string> = {
  ru: "русский",
  en: "английский",
  de: "немецкий",
  fr: "французский",
  es: "испанский",
  pt: "португальский",
  it: "итальянский",
  tr: "турецкий",
  uk: "украинский",
  pl: "польский",
  nl: "нидерландский",
  cs: "чешский",
  ro: "румынский",
  ar: "арабский",
  fa: "персидский",
  he: "иврит",
  hi: "хинди",
  ur: "урду",
  bn: "бенгальский",
  id: "индонезийский",
  ja: "японский",
  ko: "корейский",
  zh: "китайский",
  vi: "вьетнамский",
  th: "тайский",
  kk: "казахский",
  uz: "узбекский",
  az: "азербайджанский",
  hy: "армянский",
  ka: "грузинский",
  sr: "сербский",
  bg: "болгарский",
  el: "греческий",
  sv: "шведский",
  fi: "финский",
  da: "датский",
  no: "норвежский",
  hu: "венгерский",
  sk: "словацкий",
  lt: "литовский",
  lv: "латышский",
  et: "эстонский",
};

/** Английские названия — используются в промпте модели. */
const LANGUAGE_NAMES_EN: Record<string, string> = {
  ru: "Russian",
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  tr: "Turkish",
  uk: "Ukrainian",
  pl: "Polish",
  nl: "Dutch",
  cs: "Czech",
  ro: "Romanian",
  ar: "Arabic",
  fa: "Persian",
  he: "Hebrew",
  hi: "Hindi",
  ur: "Urdu",
  bn: "Bengali",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  vi: "Vietnamese",
  th: "Thai",
  kk: "Kazakh",
  uz: "Uzbek",
  az: "Azerbaijani",
  hy: "Armenian",
  ka: "Georgian",
  sr: "Serbian",
  bg: "Bulgarian",
  el: "Greek",
  sv: "Swedish",
  fi: "Finnish",
  da: "Danish",
  no: "Norwegian",
  hu: "Hungarian",
  sk: "Slovak",
  lt: "Lithuanian",
  lv: "Latvian",
  et: "Estonian",
};

/**
 * Приводит произвольный код (`ru-RU`, `EN_us`, `zh-Hans-CN`) к короткому коду языка.
 * Возвращает null, если строка не похожа на код языка.
 */
export function normalizeLanguage(input: string | null | undefined): string | null {
  if (!input) return null;
  const first = input.split(",")[0];
  if (!first) return null;
  const base = first.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (!base) return null;
  if (!/^[a-z]{2,3}$/.test(base)) return null;
  return base;
}

export function languageNameRu(code: string | null | undefined): string {
  const norm = normalizeLanguage(code);
  if (!norm) return "не определён";
  return LANGUAGE_NAMES_RU[norm] ?? norm;
}

export function languageNameEn(code: string | null | undefined): string {
  const norm = normalizeLanguage(code);
  if (!norm) return "English";
  return LANGUAGE_NAMES_EN[norm] ?? norm;
}

export function isSupportedWidgetLocale(code: string): code is WidgetLocale {
  return (WIDGET_LOCALES as readonly string[]).includes(code);
}

/** Список языков для выпадающего списка в панели. */
export function languageOptions(): Array<{ code: string; nameRu: string }> {
  return Object.keys(LANGUAGE_NAMES_RU)
    .map((code) => ({ code, nameRu: LANGUAGE_NAMES_RU[code] as string }))
    .sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
}
