import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";
import { normalizeLocale, resolveLocale, type LocaleInputs } from "./resolve.js";
import type { I18n, Locale, MessageParams } from "./types.js";

const catalogs: Record<Locale, Record<string, string>> = { en, "zh-CN": zhCN };
const fallbackCatalog: Record<string, string> = en;

export function createI18n(locale: Locale): I18n {
  const catalog = catalogs[locale];
  return {
    locale,
    t(key: string, params: MessageParams = {}): string {
      const template = catalog[key] ?? fallbackCatalog[key];
      if (template === undefined) throw new Error(`Unknown message key: ${key}`);
      return template.replace(/\{(\w+)\}/g, (match: string, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    },
    keys: () => Object.keys(catalog).sort(),
  };
}

export { normalizeLocale, resolveLocale };
export type { I18n, Locale, LocaleInputs, MessageParams };
