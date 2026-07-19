import { spawn } from "node:child_process";
import { Command } from "commander";
import pc from "picocolors";
import { discoverSessions } from "../discovery.js";
import { pickSession } from "../session.js";
import { startShareServer } from "../server/share-server.js";
import { createI18n, type I18n } from "../i18n/index.js";

interface ShareOpts {
  session?: string;
  port?: string;
  open?: boolean; // commander --no-open => open:false
}

/** 用系统默认方式打开一个 URL（open/xdg-open/start），best-effort，不阻塞。 */
export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 打不开就靠 stdout 打印的 URL 兜底 */
  }
}

export function shareStartupLines(i18n: I18n, isMac: boolean, url: string): string[] {
  return [
    i18n.t("share.cli.started", { url }),
    i18n.t("share.cli.browser"),
    i18n.t(isMac ? "share.cli.flow.mac" : "share.cli.flow.other"),
  ];
}

export async function runShare(opts: ShareOpts, i18n: I18n = createI18n("zh-CN")): Promise<void> {
  // 默认会话：--session 前缀 > cwd 对应 > 全局最近
  const sessions = await discoverSessions({});
  if (sessions.length === 0) {
    console.error(pc.red(i18n.t("share.cli.noSessions")));
    process.exitCode = 1;
    return;
  }
  const def = pickSession(sessions, opts.session ? { session: opts.session } : {});

  const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
  const server = await startShareServer({
    port: port && Number.isInteger(port) ? port : undefined,
    defaultSession: def?.id,
    locale: i18n.locale,
  });

  const [started, ...guidance] = shareStartupLines(i18n, process.platform === "darwin", server.url);
  console.log(`${pc.green("✔")} ${started}`);
  for (const line of guidance) console.log(pc.dim(line));

  if (opts.open !== false) openBrowser(server.url);
}

export function registerShare(program: Command, i18n: I18n = createI18n("zh-CN")): void {
  program
    .command("share")
    .description("Open a local web UI to pick turns, preview, and export/send (no cloud)")
    .option("--session <prefix>", "preselect a session by id prefix")
    .option("--port <n>", "preferred port (falls back to a free one if taken)")
    .option("--no-open", "do not auto-open the browser (just print the URL)")
    .action(async (opts: ShareOpts) => {
      try {
        await runShare(opts, i18n);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
