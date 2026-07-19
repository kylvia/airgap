export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = "auto" | Locale;

export const LANGUAGE_PREFERENCES = ["auto", ...SUPPORTED_LOCALES] as const;

export type MessageParams = Record<string, string | number>;

export interface I18n {
  locale: Locale;
  t(key: string, params?: MessageParams): string;
  keys(): string[];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
