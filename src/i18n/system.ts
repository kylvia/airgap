import { execFile } from "node:child_process";
import { resolveLocaleSelection, type LocaleInputs, type LocaleSelection } from "./resolve.js";

export interface SystemLocaleResult {
  locale?: string;
  source: string;
}

export interface SystemLocaleOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  intlLocale?: string;
  readMacLanguages?: () => Promise<string>;
}

export function parseAppleLanguages(output: string): string | undefined {
  const list = output.trim();
  if (!list.startsWith("(") || !list.endsWith(")")) return undefined;

  const locale = list.match(/^\(\s*"([^"\r\n]+)"(?:\s*,|\s*\))/)?.[1]?.trim();
  if (!locale || !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(locale)) return undefined;
  return locale;
}

function readMacLanguages(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("defaults", ["read", "-g", "AppleLanguages"], { timeout: 1000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function localeFromEnv(env: Record<string, string | undefined>): SystemLocaleResult | undefined {
  for (const source of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
    const locale = env[source]?.trim();
    if (locale) return { locale, source };
  }
  return undefined;
}

export async function detectSystemLocale(options: SystemLocaleOptions = {}): Promise<SystemLocaleResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const intlLocale = options.intlLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;

  if (platform === "darwin") {
    try {
      const locale = parseAppleLanguages(await (options.readMacLanguages ?? readMacLanguages)());
      if (locale) return { locale, source: "macOS AppleLanguages" };
    } catch {
      // A missing or blocked `defaults` command should not prevent CLI startup.
    }
  }

  if (platform === "win32" && intlLocale.trim()) {
    return { locale: intlLocale.trim(), source: "Windows Intl" };
  }

  const environmentLocale = localeFromEnv(env);
  if (environmentLocale) return environmentLocale;

  if (intlLocale.trim()) return { locale: intlLocale.trim(), source: "Intl" };
  return { source: "English fallback" };
}

type ExplicitLocaleInputs = Pick<LocaleInputs, "cli" | "env" | "config">;
type SystemLocaleDetector = () => Promise<SystemLocaleResult>;

export async function resolveLanguage(
  inputs: ExplicitLocaleInputs,
  detector: SystemLocaleDetector = detectSystemLocale,
): Promise<LocaleSelection> {
  const hasExplicitLocale = [inputs.cli, inputs.env, inputs.config].some((value) => value?.trim());
  if (hasExplicitLocale) return resolveLocaleSelection(inputs);

  const systemLocale = await detector();
  return resolveLocaleSelection({ ...inputs, system: systemLocale.locale }, systemLocale.source);
}
