import { normalizeLanguage, WIDGET_LOCALES } from './languages.js';
import type { WidgetSettings } from './types.js';
import type { WidgetStrings } from './widget-i18n.js';

export const WIDGET_TEXT_FIELDS = ['title', 'subtitle', 'greeting', 'handoffNotice', 'offlineNotice', 'launcherLabel'] as const;
export type WidgetTexts = Pick<WidgetSettings, typeof WIDGET_TEXT_FIELDS[number]>;
export function widgetTexts(settings: WidgetSettings): WidgetTexts {
  return Object.fromEntries(WIDGET_TEXT_FIELDS.map(key => [key, settings[key]])) as WidgetTexts;
}
export function resolveWidgetLocale(configured: string, hint?: string | null): string {
  const lang = normalizeLanguage((configured === 'auto' ? hint : configured)?.split(';')[0]) || 'en';
  return (WIDGET_LOCALES as readonly string[]).includes(lang) ? lang : 'en';
}
export interface WidgetLocalization {
  sourceLanguage: 'ru';
  targetLanguage: string;
  effectiveLanguage: string;
  status: 'source' | 'cached' | 'translated' | 'pending' | 'unavailable' | 'failed';
  error?: string;
}
export interface LocalizedWidget {
  settings: WidgetSettings;
  strings: WidgetStrings;
  localization: WidgetLocalization;
}
