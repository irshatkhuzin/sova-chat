export { pickStrings, type WidgetStrings } from "@sova/shared";

export function detectBrowserLocale(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || navigator.languages?.[0] || 'en';
}
