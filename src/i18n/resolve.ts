import type { Locale } from "./types.js";

export interface LocaleInputs {
  cli?: string;
  env?: string;
  config?: string;
  system?: string;
}

export function normalizeLocale(value?: string): Locale | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\..*$/, "").replace(/_/g, "-");
  if (/^en(?:-|$)/i.test(normalized)) return "en";
  if (/^zh(?:-(?:CN|SG|Hans)(?:-|$)|$)/i.test(normalized)) return "zh-CN";
  return undefined;
}

export function resolveLocale(inputs: LocaleInputs): Locale {
  for (const value of [inputs.cli, inputs.env, inputs.config]) {
    if (value !== undefined && value.trim() !== "") return normalizeLocale(value) ?? "en";
  }
  return normalizeLocale(inputs.system) ?? "en";
}
