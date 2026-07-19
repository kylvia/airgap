import type { Command } from "commander";
import type { AirgapConfig } from "./config.js";
import type { I18n } from "./i18n/index.js";
import {
  checkForUpdate,
  type UpdateCheckOptions,
} from "./update-check.js";

export function extractLangArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lang") return argv[i + 1];
    if (arg?.startsWith("--lang=")) return arg.slice("--lang=".length);
  }
  return undefined;
}

interface UpdateCheckHookOptions {
  currentVersion: string;
  i18n: I18n;
  config: AirgapConfig;
  argv: string[];
  check?: (options: UpdateCheckOptions) => Promise<void>;
}

export function registerUpdateCheckHook(
  program: Command,
  options: UpdateCheckHookOptions,
): void {
  program.hook("preAction", async () => {
    await (options.check ?? checkForUpdate)({
      currentVersion: options.currentVersion,
      i18n: options.i18n,
      argv: options.argv,
      env: process.env,
      configEnabled: options.config.updateCheck,
      stdoutIsTTY: process.stdout.isTTY,
      stderrIsTTY: process.stderr.isTTY,
    });
  });
}
