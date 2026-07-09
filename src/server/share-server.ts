import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { RuleMatch, SessionInfo, ToolDisplay, Turn } from "../types.js";
import { DEFAULT_TOOL_DISPLAY, TOOL_DISPLAYS } from "../types.js";
import { loadConfig, sessionListLimit, updateSessionListLimit } from "../config.js";
import { discoverSessions } from "../discovery.js";
import { scanString } from "../detect/scanner.js";
import { extractTurns } from "../render/turns.js";
import { renderHtml, renderTurnBlock } from "../render/html.js";
import { renderMarkdown } from "../render/markdown.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import { oneLine, peekTitle, pickSession, readRecords, redactTurns, scanOneTurn, scanTurns, sessionTitle, turnTag } from "../session.js";
import { renderPage } from "./page.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无请求自退，别留僵尸

// ---------- API 数据形态 ----------

interface SessionSummary {
  id: string;
  project: string;
  source: string;
  mtimeMs: number;
  /** latest ai-title (claude only); null → 前端回退 "<project> · 会话片段" */
  title: string | null;
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
  /** claude | codex —— 前端用它拼对应的 resume 命令（claude --resume / codex resume） */
  source: string;
  /** 会话原始工作目录；resume 必须回到这里才有文件语境，前端拼进 `cd … && resume` */
  cwd: string | null;
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
  /** redact detected secrets (placeholders) before rendering — the safe default in the UI */
  redact?: boolean;
  /** caller has seen the findings and explicitly accepts exporting them un-redacted */
  acceptRisk?: boolean;
  /** tool-call display level; invalid/absent values fall back to the default */
  tools?: string;
}

/** 宽松解析工具展示级别：非法/缺省一律回落默认，绝不因 UI 参数报错。 */
function parseToolDisplay(v: unknown): ToolDisplay {
  return typeof v === "string" && (TOOL_DISPLAYS as readonly string[]).includes(v) ? (v as ToolDisplay) : DEFAULT_TOOL_DISPLAY;
}

// ---------- 会话读取 ----------

/** 下拉只放最近 limit 个（config: share.sessionListLimit，常用 10/20/50）；更早的用 `airgap share --session <前缀>` 直开。 */
async function listSessions(limit: number, ensureId?: string): Promise<SessionSummary[]> {
  const sessions = await discoverSessions({});
  const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = sorted.slice(0, limit);
  // --session 指定的会话若比 limit 还老，补进列表尾——否则前端下拉里没有它，预选会静默落空。
  if (ensureId && !top.some((s) => s.id === ensureId)) {
    const hit = sorted.find((s) => s.id === ensureId);
    if (hit) top.push(hit);
  }
  // 标题并行流扫（peekTitle 只 parse 命中 ai-title 预过滤的行，几十个会话数百 ms 级）
  return Promise.all(
    top.map(async (s) => ({
      id: s.id,
      project: s.cwd ? path.basename(s.cwd) : s.project,
      source: s.source,
      mtimeMs: s.mtimeMs,
      title: await peekTitle(s.file),
    })),
  );
}

async function findSession(id: string): Promise<SessionInfo | null> {
  const sessions = await discoverSessions({});
  return sessions.find((s) => s.id === id) ?? pickSession(sessions, { session: id });
}

async function loadDetail(id: string, tools: ToolDisplay): Promise<SessionDetail | null> {
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
    html: renderTurnBlock(t, { tools }),
    // findings 始终扫全部字段（含 summary/none 下不渲染的 tool i/o）——从宽标记，与导出闸一致
    findings: scanOneTurn(t, scanString).length,
  }));
  return { id: info.id, source: info.source, cwd: info.cwd, title, date, turns: turnData };
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
  /** 服务端扫描拦下（含密钥且未 acceptRisk）：HTTP 层回 409，前端可确认后带 acceptRisk 重试 */
  blocked?: boolean;
  /** download 时的 PNG 字节 */
  bytes?: Buffer;
  filename?: string;
}

/**
 * 服务端导出前的二次拦截：前端 confirm 可被绕过（或有人直接打 /api/export），所以在真正
 * 渲染导出前再扫一遍选中轮次的可见内容（含 tool input/result）。命中且调用方未显式
 * acceptRisk 时返回一句拒绝理由；否则返回 null 放行。scan 可注入，默认用真实 scanString。
 */
export function exportBlockReason(
  turns: Turn[],
  acceptRisk: boolean | undefined,
  scan: (s: string) => RuleMatch[] = scanString,
): string | null {
  if (acceptRisk) return null;
  const findings = scanTurns(turns, scan);
  if (findings.length === 0) return null;
  const brief = findings
    .slice(0, 5)
    .map((f) => `${f.ruleId} ${f.preview}`)
    .join("、");
  return `选中内容含 ${findings.length} 处疑似密钥（${brief}${findings.length > 5 ? " 等" : ""}）；确认无误可接受风险重新导出，或先用 airgap pack 走 redact。`;
}

async function renderPng(turns: Turn[], title: string, date: string, tools: ToolDisplay): Promise<string> {
  const chrome = findChrome();
  if (!chrome) throw new Error("没找到本机 Chrome/Chromium（出图需要它）。可设 CHROME_PATH，或改用「存桌面」的 HTML/Markdown。");
  const html = renderHtml(turns, { title, date }, { tools });
  // 无空格英文临时名，避开 osascript 路径转义坑
  const pngPath = path.join(os.tmpdir(), `airgap-share-${randomUUID()}.png`);
  await renderPngViaChrome(html, pngPath, chrome);
  return pngPath;
}

async function handleExport(body: ExportBody): Promise<ExportResult> {
  const sel = await selectedTurns(body.sessionId, body.turns);
  if (!sel || sel.turns.length === 0) return { ok: false, message: "没有选中任何轮次" };
  const { turns: rawTurns, title, date } = sel;
  const tools = parseToolDisplay(body.tools);

  // 脱敏后导出（UI 默认）：占位符替换，fail-closed 保证干净，无需再拦截。
  // 否则真正渲染前二次复扫——前端 confirm 可被绕过，服务端才是最后一道闸。
  let turns = rawTurns;
  let redactNote = "";
  if (body.redact) {
    const red = redactTurns(rawTurns, scanString);
    turns = red.turns;
    if (red.count > 0) redactNote = `（已脱敏 ${red.count} 处疑似密钥）`;
  } else {
    const blockReason = exportBlockReason(rawTurns, body.acceptRisk);
    if (blockReason) return { ok: false, blocked: true, message: blockReason };
  }

  const isMac = process.platform === "darwin";

  // 存桌面：png / html / md 三格式
  if (body.action === "save") {
    const desktop = path.join(os.homedir(), "Desktop");
    await mkdir(desktop, { recursive: true });
    const outPath = path.join(desktop, `airgap-share-${stamp()}.${body.format}`);
    if (body.format === "png") {
      const png = await renderPng(turns, title, date, tools);
      await writeFile(outPath, await readFile(png));
    } else if (body.format === "html") {
      await writeFile(outPath, renderHtml(turns, { title, date }, { tools }), "utf8");
    } else {
      await writeFile(outPath, renderMarkdown(turns, { title, date }, { tools }), "utf8");
    }
    return { ok: true, message: `已存到 ${outPath}${redactNote}` };
  }

  // 浏览器下载：回 PNG 字节
  if (body.action === "download") {
    const png = await renderPng(turns, title, date, tools);
    return { ok: true, message: "download", bytes: await readFile(png), filename: `airgap-share-${stamp()}.png` };
  }

  // 复制到剪贴板：png → 系统剪贴板；md → pbcopy 文本
  if (body.action === "clipboard") {
    if (!isMac) return { ok: false, message: "复制到剪贴板目前仅 macOS 支持，请改用「下载」或「存桌面」。" };
    if (body.format === "md") {
      await run("pbcopy", [], renderMarkdown(turns, { title, date }, { tools }));
      return { ok: true, message: `Markdown 已复制到剪贴板${redactNote}，去微信/公众号 Cmd-V 粘贴。` };
    }
    const png = await renderPng(turns, title, date, tools);
    await pngToClipboard(png);
    return { ok: true, message: `长图已复制到剪贴板${redactNote}，切到微信选好聊天，Cmd-V 粘贴发送。` };
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
  // 启动时读 config；页面上的条数选择器经 POST /api/config 持久化并即时更新这里
  let listLimit = sessionListLimit(await loadConfig());
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
      // ?ensure=<id>：前端焦点刷新时保证「当前正在看的会话」始终在列表里（可能比 limit 老）
      const ensure = url.searchParams.get("ensure") ?? opts.defaultSession;
      sendJson(res, 200, { sessions: await listSessions(listLimit, ensure ?? undefined), limit: listLimit });
      return;
    }
    if (req.method === "POST" && p === "/api/config") {
      const body = JSON.parse(await readBody(req)) as { sessionListLimit?: unknown };
      const n = body.sessionListLimit;
      if (typeof n !== "number" || !Number.isInteger(n)) {
        sendJson(res, 400, { ok: false, message: "sessionListLimit 需要整数" });
        return;
      }
      try {
        listLimit = await updateSessionListLimit(n);
        sendJson(res, 200, { ok: true, limit: listLimit });
      } catch (err) {
        sendJson(res, 500, { ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (req.method === "GET" && p.startsWith("/api/session/")) {
      const id = decodeURIComponent(p.slice("/api/session/".length));
      const detail = await loadDetail(id, parseToolDisplay(url.searchParams.get("tools")));
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
      const status = result.ok ? 200 : result.blocked ? 409 : 400;
      sendJson(res, status, { ok: result.ok, blocked: result.blocked, message: result.message });
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
