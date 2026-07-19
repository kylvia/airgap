import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  normalizeLocale,
  resolveLocale,
  resolveLocaleSelection,
  type LocaleInputs,
  type LocaleSelection,
} from "./resolve.js";
import type { I18n, Locale, MessageParams } from "./types.js";

const catalogs: Record<Locale, Record<string, string>> = { en, "zh-CN": zhCN };
const fallbackCatalog: Record<string, string> = en;

export function createI18n(locale: Locale): I18n {
  const catalog = catalogs[locale];
  return {
    locale,
    t(key: string, params: MessageParams = {}): string {
      const singularKey = params["count"] === 1 ? `${key}.one` : undefined;
      const template =
        (singularKey ? catalog[singularKey] ?? fallbackCatalog[singularKey] : undefined) ??
        catalog[key] ??
        fallbackCatalog[key];
      if (template === undefined) throw new Error(`Unknown message key: ${key}`);
      return template.replace(/\{(\w+)\}/g, (match: string, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    },
    keys: () => Object.keys(catalog).sort(),
  };
}

export { normalizeLocale, resolveLocale, resolveLocaleSelection };
export type { I18n, Locale, LocaleInputs, LocaleSelection, MessageParams };
