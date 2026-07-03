import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { SessionInfo, Turn } from "../types.js";
import { discoverSessions } from "../discovery.js";
import { scanString } from "../detect/scanner.js";
import { extractTurns } from "../render/turns.js";
import { renderHtml, renderTurnBlock } from "../render/html.js";
import { renderMarkdown } from "../render/markdown.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import { oneLine, pickSession, readRecords, scanOneTurn, sessionTitle, turnTag } from "../session.js";
import { renderPage } from "./page.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无请求自退，别留僵尸
const MAX_LIST = 15;

// ---------- API 数据形态 ----------

interface SessionSummary {
  id: string;
  project: string;
  source: string;
  mtimeMs: number;
}

interface TurnData {
  index: number;
  preview: string; // 用户文本前若干字，供左侧列表
  tag: string; // 任务通知 / 命令 / 图片 / 系统 / ""
  html: string; // 该轮渲染好的聊天风片段
  findings: number; // 该轮命中的疑似密钥数
}

interface SessionDetail {
  id: string;
  title: string;
  date: string;
  turns: TurnData[];
}

type ExportAction = "clipboard" | "save" | "download";
type ExportFormat = "png" | "html" | "md";

interface ExportBody {
  sessionId: string;
  turns: number[];
  format: ExportFormat;
  action: ExportAction;
}

// ---------- 会话读取 ----------

async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await discoverSessions({});
  return [...sessions]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_LIST)
    .map((s) => ({
      id: s.id,
      project: s.cwd ? path.basename(s.cwd) : s.project,
      source: s.source,
      mtimeMs: s.mtimeMs,
    }));
}

async function findSession(id: string): Promise<SessionInfo | null> {
  const sessions = await discoverSessions({});
  return sessions.find((s) => s.id === id) ?? pickSession(sessions, { session: id });
}

async function loadDetail(id: string): Promise<SessionDetail | null> {
  const info = await findSession(id);
  if (!info) return null;
  const records = await readRecords(info.file);
  const turns = extractTurns(records, info.source);
  const title = sessionTitle(records, info);
  const lastTs = turns[turns.length - 1]?.timestamp;
  const date = (lastTs ?? new Date(info.mtimeMs).toISOString()).slice(0, 10);
  const turnData: TurnData[] = turns.map((t) => ({
    index: t.index,
    preview: oneLine(t.userText).slice(0, 60),
    tag: turnTag(t.userText),
    html: renderTurnBlock(t),
    findings: scanOneTurn(t, scanString).length,
  }));
  return { id: info.id, title, date, turns: turnData };
}

async function selectedTurns(id: string, want: number[]): Promise<{ info: SessionInfo; turns: Turn[]; title: string; date: string } | null> {
  const info = await findSession(id);
  if (!info) return null;
  const records = await readRecords(info.file);
  const all = extractTurns(records, info.source);
  const set = new Set(want);
  const turns = all.filter((t) => set.has(t.index));
  const title = sessionTitle(records, info);
  const lastTs = turns[turns.length - 1]?.timestamp ?? all[all.length - 1]?.timestamp;
  const date = (lastTs ?? new Date(info.mtimeMs).toISOString()).slice(0, 10);
  return { info, turns, title, date };
}

// ---------- 发送/导出 ----------

function stamp(): string {
  const d = new Date();
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function run(cmd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

async function pngToClipboard(pngPath: string): Promise<void> {
  // vanilla AppleScript 路径：直接把文件字节当 PNG 灌进 pasteboard，不经 NSImage，大图稳。
  // « » 用 \u 转义避免源码编码坑。
  const script = `set the clipboard to (read (POSIX file "${pngPath}") as «class PNGf»)`;
  await run("osascript", ["-e", script]);
}

interface ExportResult {
  ok: boolean;
  message: string;
  /** download 时的 PNG 字节 */
  bytes?: Buffer;
  filename?: string;
}

async function renderPng(turns: Turn[], title: string, date: string): Promise<string> {
  const chrome = findChrome();
  if (!chrome) throw new Error("没找到本机 Chrome/Chromium（出图需要它）。可设 CHROME_PATH，或改用「存桌面」的 HTML/Markdown。");
  const html = renderHtml(turns, { title, date });
  // 无空格英文临时名，避开 osascript 路径转义坑
  const pngPath = path.join(os.tmpdir(), `airgap-share-${randomUUID()}.png`);
  await renderPngViaChrome(html, pngPath, chrome);
  return pngPath;
}

async function handleExport(body: ExportBody): Promise<ExportResult> {
  const sel = await selectedTurns(body.sessionId, body.turns);
  if (!sel || sel.turns.length === 0) return { ok: false, message: "没有选中任何轮次" };
  const { turns, title, date } = sel;
  const isMac = process.platform === "darwin";

  // 存桌面：png / html / md 三格式
  if (body.action === "save") {
    const desktop = path.join(os.homedir(), "Desktop");
    await mkdir(desktop, { recursive: true });
    const outPath = path.join(desktop, `airgap-share-${stamp()}.${body.format}`);
    if (body.format === "png") {
      const png = await renderPng(turns, title, date);
      await writeFile(outPath, await readFile(png));
    } else if (body.format === "html") {
      await writeFile(outPath, renderHtml(turns, { title, date }), "utf8");
    } else {
      await writeFile(outPath, renderMarkdown(turns, { title, date }), "utf8");
    }
    return { ok: true, message: `已存到 ${outPath}` };
  }

  // 浏览器下载：回 PNG 字节
  if (body.action === "download") {
    const png = await renderPng(turns, title, date);
    return { ok: true, message: "download", bytes: await readFile(png), filename: `airgap-share-${stamp()}.png` };
  }

  // 复制到剪贴板：png → 系统剪贴板；md → pbcopy 文本
  if (body.action === "clipboard") {
    if (!isMac) return { ok: false, message: "复制到剪贴板目前仅 macOS 支持，请改用「下载」或「存桌面」。" };
    if (body.format === "md") {
      await run("pbcopy", [], renderMarkdown(turns, { title, date }));
      return { ok: true, message: "Markdown 已复制到剪贴板，去微信/公众号 Cmd-V 粘贴。" };
    }
    const png = await renderPng(turns, title, date);
    await pngToClipboard(png);
    return { ok: true, message: "长图已复制到剪贴板，切到微信选好聊天，Cmd-V 粘贴发送。" };
  }

  return { ok: false, message: "未知操作" };
}

// ---------- HTTP ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

export interface ShareServer {
  url: string;
  close(): void;
}

export async function startShareServer(opts: { port?: number; defaultSession?: string }): Promise<ShareServer> {
  let idleTimer: NodeJS.Timeout;
  const touch = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log("airgap share: 空闲超时，已自动关闭。");
      server.close();
      process.exit(0);
    }, IDLE_TIMEOUT_MS);
  };

  const server: Server = createServer((req, res) => {
    touch();
    void handle(req, res).catch((err: unknown) => {
      sendJson(res, 500, { ok: false, message: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;

    if (req.method === "GET" && p === "/") {
      const html = renderPage(opts.defaultSession);
      const buf = Buffer.from(html, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": buf.length });
      res.end(buf);
      return;
    }
    if (req.method === "GET" && p === "/api/sessions") {
      sendJson(res, 200, { sessions: await listSessions() });
      return;
    }
    if (req.method === "GET" && p.startsWith("/api/session/")) {
      const id = decodeURIComponent(p.slice("/api/session/".length));
      const detail = await loadDetail(id);
      if (!detail) {
        sendJson(res, 404, { message: "找不到该会话" });
        return;
      }
      sendJson(res, 200, detail);
      return;
    }
    if (req.method === "POST" && p === "/api/export") {
      const body = JSON.parse(await readBody(req)) as ExportBody;
      const result = await handleExport(body);
      if (result.ok && result.bytes) {
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": result.bytes.length,
          "content-disposition": `attachment; filename="${result.filename ?? "airgap-share.png"}"`,
        });
        res.end(result.bytes);
        return;
      }
      sendJson(res, result.ok ? 200 : 400, { ok: result.ok, message: result.message });
      return;
    }
    if (req.method === "POST" && p === "/api/close") {
      sendJson(res, 200, { ok: true });
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 100);
      return;
    }
    sendJson(res, 404, { message: "not found" });
  }

  const port = await listen(server, opts.port);
  touch();
  return {
    url: `http://localhost:${port}/`,
    close: () => {
      clearTimeout(idleTimer);
      server.close();
    },
  };
}

/** 优先用指定端口，被占则回退到 OS 分配的空闲端口。 */
function listen(server: Server, preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "EADDRINUSE" && preferred) {
        server.listen(0, "127.0.0.1");
      } else {
        reject(err);
      }
    };
    server.on("error", onError);
    server.listen(preferred ?? 0, "127.0.0.1", () => {
      server.off("error", onError);
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(port);
    });
  });
}
