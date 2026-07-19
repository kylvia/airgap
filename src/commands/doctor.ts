import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import pc from "picocolors";
import type { Command } from "commander";
import type { I18n, LocaleSelection } from "../i18n/index.js";

const require = createRequire(import.meta.url);

function airgapVersion(): string {
  for (const p of ["../package.json", "../../package.json"]) {
    try {
      return (require(p) as { version: string }).version;
    } catch {
      /* keep looking */
    }
  }
  return "unknown";
}

/** Run `<cmd> --version` with a 3s timeout; resolve null on any failure. */
export function probeToolVersion(cmd: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = execFile(cmd, ["--version"], { timeout: timeoutMs }, (err, stdout) => {
        if (err) return resolve(null);
        const first = stdout.trim().split("\n")[0];
        resolve(first && first.length > 0 ? first : null);
      });
      child.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

interface DoctorDependencies {
  probe?: (command: string) => Promise<string | null>;
  log?: (line: string) => void;
}

export async function runDoctor(
  language: LocaleSelection,
  i18n: I18n,
  dependencies: DoctorDependencies = {},
): Promise<void> {
  const probe = dependencies.probe ?? probeToolVersion;
  const log = dependencies.log ?? console.log;
  const [claudeV, codexV] = await Promise.all([probe("claude"), probe("codex")]);
  const row = (label: string, value: string | null): string =>
    `  ${label.padEnd(10)} ${value ? pc.green(value) : pc.yellow("未检测到（不在 PATH 或超时）")}`;

  log(pc.bold("airgap doctor"));
  log(row("airgap", airgapVersion()));
  log(row("claude", claudeV));
  log(row("codex", codexV));
  log("");
  log(`  ${i18n.t("doctor.languageSource")}: ${language.source}`);
  log(`  ${i18n.t("doctor.detectedLocale")}: ${language.detectedLocale ?? "—"}`);
  log(`  ${i18n.t("doctor.resolvedLocale")}: ${language.locale}`);
  log("");
  log(pc.bold("支持矩阵"));
  log(`  claude-jsonl-tree/1  scan ✓  pack ✓  open ✓  show ✓（实测 2.1.197/198）`);
  log(`  codex-rollout/1      scan ✓  pack ✓  open ✗（暂无 resume 注入路径）  show ✓`);
  log(pc.dim("  open 后若 claude --resume <sessionId> 找不到会话，用输出里的兜底命令（--fork-session）。"));
}

export function registerDoctor(program: Command, language: LocaleSelection, i18n: I18n): void {
  program
    .command("doctor")
    .description("Environment check: local claude/codex versions and the format support matrix")
    .action(async () => runDoctor(language, i18n));
}
