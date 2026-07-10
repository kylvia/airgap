import { spawn } from "node:child_process";
import { Command } from "commander";
import pc from "picocolors";
import { discoverSessions } from "../discovery.js";
import { pickSession } from "../session.js";
import { startShareServer } from "../server/share-server.js";

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

export async function runShare(opts: ShareOpts): Promise<void> {
  // 默认会话：--session 前缀 > cwd 对应 > 全局最近
  const sessions = await discoverSessions({});
  if (sessions.length === 0) {
    console.error(pc.red("没发现任何本地会话（~/.claude 或 ~/.codex）。"));
    process.exitCode = 1;
    return;
  }
  const def = pickSession(sessions, opts.session ? { session: opts.session } : {});

  const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
  const server = await startShareServer({
    port: port && Number.isInteger(port) ? port : undefined,
    defaultSession: def?.id,
  });

  console.log(`${pc.green("✔")} airgap share 已启动：${pc.bold(server.url)}`);
  console.log(pc.dim("  浏览器会自动打开；没弹出就手动点上面的地址。"));
  console.log(pc.dim("  勾选轮次 → 右侧预览 → 复制长图/存桌面；用完点页面「完成关闭」，或 10 分钟空闲自动退出。"));

  if (opts.open !== false) openBrowser(server.url);
}

export function registerShare(program: Command): void {
  program
    .command("share")
    .description("Open a local web UI to pick turns, preview, and export/send (no cloud)")
    .option("--session <prefix>", "preselect a session by id prefix")
    .option("--port <n>", "preferred port (falls back to a free one if taken)")
    .option("--no-open", "do not auto-open the browser (just print the URL)")
    .action(async (opts: ShareOpts) => {
      try {
        await runShare(opts);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
