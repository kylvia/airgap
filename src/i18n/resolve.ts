import type { Locale } from "./types.js";

export interface LocaleInputs {
  cli?: string;
  env?: string;
  config?: string;
  system?: string;
}

export interface LocaleSelection {
  locale: Locale;
  source: string;
  detectedLocale?: string;
}

export function normalizeLocale(value?: string): Locale | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\..*$/, "").replace(/_/g, "-");
  if (/^en(?:-|$)/i.test(normalized)) return "en";
  if (/^zh(?:-(?:CN|SG|Hans)(?:-|$)|$)/i.test(normalized)) return "zh-CN";
  return undefined;
}

export function resolveLocaleSelection(
  inputs: LocaleInputs,
  systemSource = "system locale",
): LocaleSelection {
  const explicitInputs: Array<[value: string | undefined, source: string]> = [
    [inputs.cli, "--lang"],
    [inputs.env, "AIRGAP_LANG"],
    [inputs.config, "config.language"],
  ];

  for (const [value, source] of explicitInputs) {
    const detectedLocale = value?.trim();
    if (detectedLocale) {
      return { locale: normalizeLocale(detectedLocale) ?? "en", source, detectedLocale };
    }
  }

  const detectedLocale = inputs.system?.trim();
  if (detectedLocale) {
    return {
      locale: normalizeLocale(detectedLocale) ?? "en",
      source: systemSource,
      detectedLocale,
    };
  }

  return { locale: "en", source: "English fallback" };
}

export function resolveLocale(inputs: LocaleInputs): Locale {
  return resolveLocaleSelection(inputs).locale;
}
