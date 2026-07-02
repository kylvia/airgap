import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import pc from "picocolors";
import type { Command } from "commander";

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

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("环境体检：本机 claude/codex 版本与格式支持矩阵")
    .action(async () => {
      const [claudeV, codexV] = await Promise.all([probeToolVersion("claude"), probeToolVersion("codex")]);
      const row = (label: string, value: string | null): string =>
        `  ${label.padEnd(10)} ${value ? pc.green(value) : pc.yellow("未检测到（不在 PATH 或超时）")}`;

      console.log(pc.bold("airgap doctor"));
      console.log(row("airgap", airgapVersion()));
      console.log(row("claude", claudeV));
      console.log(row("codex", codexV));
      console.log("");
      console.log(pc.bold("支持矩阵"));
      console.log(`  claude-jsonl-tree/1  scan ✓  pack ✓  open ✓  show ✓（实测 2.1.197/198）`);
      console.log(`  codex-rollout/1      scan ✓  pack ✓  open ✗（暂无 resume 注入路径）  show ✓`);
      console.log(pc.dim("  open 后若 claude --resume <sessionId> 找不到会话，用输出里的兜底命令（--fork-session）。"));
    });
}
