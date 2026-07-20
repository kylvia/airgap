import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { RuleMatch, SessionInfo, ToolDisplay, Turn } from "../types.js";
import { DEFAULT_TOOL_DISPLAY, TOOL_DISPLAYS } from "../types.js";
import { loadConfig, sessionListLimit, shareToolDisplay, updateConfig, type ConfigPatch } from "../config.js";
import { discoverSessions } from "../discovery.js";
import { scanString } from "../detect/scanner.js";
import { extractTurns } from "../render/turns.js";
import { renderHtml, renderTurnBlock } from "../render/html.js";
import { renderMarkdown } from "../render/markdown.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import { oneLine, peekTitle, pickSession, readRecords, redactTurns, scanOneTurn, scanTurns, sessionTitle, turnTag } from "../session.js";
import { renderPage } from "./page.js";
import {
  LANGUAGE_PREFERENCES,
  createI18n,
  resolveLocale,
  type I18n,
  type LanguagePreference,
  type Locale,
} from "../i18n/index.js";
import { detectSystemLocale, type SystemLocaleResult } from "../i18n/system.js";
import {
  isAllowedOrigin,
  isValidShareAccessToken,
  readCookie,
  shareCookieName,
  tokensEqual,
} from "./share-access.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无请求自退，别留僵尸
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 1_000;

// 复制到系统剪贴板走 osascript/pbcopy，只有 macOS 支持；页面据此把「下载 PNG」设为非 mac 的主按钮。
const isMac = process.platform === "darwin";

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

const IDE_CONTEXT_PREFIX = "# Context from my IDE setup:";
const IDE_REQUEST_MARKER = "\n## My request for Codex:";

/**
 * IDE 会把活动文件、打开标签页和真实请求合并为一条 Codex user message。
 * share 的非完整档只展示真实请求；完整档保留原始转录，供需要完整上下文的导出使用。
 * 未命中完整的已知格式时保持原文，避免误删普通用户消息。
 */
function stripIdeContext(userText: string): string {
  if (!userText.trimStart().startsWith(IDE_CONTEXT_PREFIX)) return userText;
  const marker = userText.indexOf(IDE_REQUEST_MARKER);
  if (marker === -1) return userText;
  const request = userText.slice(marker + IDE_REQUEST_MARKER.length).trim();
  return request || userText;
}

/**
 * 仅 share 的预览与导出根据工具档位裁剪 IDE 注入上下文；CLI show 保持原始会话语义。
 * 返回新 Turn，不能修改 extractTurns 的结果，以便完整档和后续使用者仍能取得原文。
 */
export function shareTurnsForDisplay(turns: Turn[], tools: ToolDisplay): Turn[] {
  if (tools === "full") return turns;
  return turns.map((turn) => {
    const userText = stripIdeContext(turn.userText);
    return userText === turn.userText ? turn : { ...turn, userText };
  });
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

async function loadDetail(id: string, tools: ToolDisplay, locale: Locale): Promise<SessionDetail | null> {
  const info = await findSession(id);
  if (!info) return null;
  const records = await readRecords(info.file);
  const turns = shareTurnsForDisplay(extractTurns(records, info.source), tools);
  const title = sessionTitle(records, info, locale);
  const lastTs = turns[turns.length - 1]?.timestamp;
  const date = (lastTs ?? new Date(info.mtimeMs).toISOString()).slice(0, 10);
  const turnData: TurnData[] = turns.map((t) => ({
    index: t.index,
    preview: oneLine(t.userText).slice(0, 60),
    tag: turnTag(t.userText, locale),
    html: renderTurnBlock(t, { tools, locale }),
    // findings 始终扫全部字段（含 summary/none 下不渲染的 tool i/o）——从宽标记，与导出闸一致
    findings: scanOneTurn(t, scanString).length,
  }));
  return { id: info.id, source: info.source, cwd: info.cwd, title, date, turns: turnData };
}

async function selectedTurns(
  id: string,
  want: number[],
  tools: ToolDisplay,
  locale: Locale,
): Promise<{ info: SessionInfo; turns: Turn[]; title: string; date: string } | null> {
  const info = await findSession(id);
  if (!info) return null;
  const records = await readRecords(info.file);
  const all = shareTurnsForDisplay(extractTurns(records, info.source), tools);
  const set = new Set(want);
  const turns = all.filter((t) => set.has(t.index));
  const title = sessionTitle(records, info, locale);
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
  code?: string;
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
  locale: Locale = "zh-CN",
): string | null {
  if (acceptRisk) return null;
  const findings = scanTurns(turns, scan);
  if (findings.length === 0) return null;
  const brief = findings
    .slice(0, 5)
    .map((f) => `${f.ruleId} ${f.preview}`)
    .join("、");
  const i18n = createI18n(locale);
  return i18n.t("share.api.exportRisk", {
    count: findings.length,
    brief,
    more: findings.length > 5 ? i18n.t("share.api.more") : "",
  });
}

async function renderPng(turns: Turn[], title: string, date: string, tools: ToolDisplay, locale: Locale): Promise<string> {
  const chrome = findChrome();
  if (!chrome) throw new Error(createI18n(locale).t("share.api.chromeMissing"));
  const html = renderHtml(turns, { title, date }, { tools, locale });
  // 无空格英文临时名，避开 osascript 路径转义坑
  const pngPath = path.join(os.tmpdir(), `airgap-share-${randomUUID()}.png`);
  await renderPngViaChrome(html, pngPath, chrome);
  return pngPath;
}

async function handleExport(body: ExportBody, locale: Locale): Promise<ExportResult> {
  const i18n = createI18n(locale);
  const tools = parseToolDisplay(body.tools);
  const sel = await selectedTurns(body.sessionId, body.turns, tools, locale);
  if (!sel || sel.turns.length === 0) {
    return { ok: false, code: "NO_TURNS_SELECTED", message: i18n.t("share.api.noSelection") };
  }
  const { turns: rawTurns, title, date } = sel;

  // 脱敏后导出（UI 默认）：占位符替换，fail-closed 保证干净，无需再拦截。
  // 否则真正渲染前二次复扫——前端 confirm 可被绕过，服务端才是最后一道闸。
  let turns = rawTurns;
  let redactNote = "";
  if (body.redact) {
    const red = redactTurns(rawTurns, scanString);
    turns = red.turns;
    if (red.count > 0) redactNote = i18n.t("share.api.redactedNote", { count: red.count });
  } else {
    const blockReason = exportBlockReason(rawTurns, body.acceptRisk, scanString, locale);
    if (blockReason) return { ok: false, blocked: true, code: "EXPORT_SECRET_RISK", message: blockReason };
  }

  // 存桌面：png / html / md 三格式
  if (body.action === "save") {
    // 本地化的 Linux 桌面（如 ~/桌面）会导出到 user-dirs.dirs 里的 XDG_DESKTOP_DIR；未设置时兜底 ~/Desktop。
    const desktop = process.env["XDG_DESKTOP_DIR"] || path.join(os.homedir(), "Desktop");
    await mkdir(desktop, { recursive: true });
    const outPath = path.join(desktop, `airgap-share-${stamp()}.${body.format}`);
    if (body.format === "png") {
      const png = await renderPng(turns, title, date, tools, locale);
      await writeFile(outPath, await readFile(png));
    } else if (body.format === "html") {
      await writeFile(outPath, renderHtml(turns, { title, date }, { tools, locale }), "utf8");
    } else {
      await writeFile(outPath, renderMarkdown(turns, { title, date }, { tools, locale }), "utf8");
    }
    return { ok: true, message: i18n.t("share.api.saved", { path: outPath, note: redactNote }) };
  }

  // 浏览器下载：回 PNG 字节
  if (body.action === "download") {
    const png = await renderPng(turns, title, date, tools, locale);
    return { ok: true, message: "download", bytes: await readFile(png), filename: `airgap-share-${stamp()}.png` };
  }

  // 复制到剪贴板：png → 系统剪贴板；md → pbcopy 文本
  if (body.action === "clipboard") {
    if (!isMac) return { ok: false, code: "CLIPBOARD_UNSUPPORTED", message: i18n.t("share.api.clipboardMacOnly") };
    if (body.format === "md") {
      await run("pbcopy", [], renderMarkdown(turns, { title, date }, { tools, locale }));
      return { ok: true, message: i18n.t("share.api.markdownCopied", { note: redactNote }) };
    }
    const png = await renderPng(turns, title, date, tools, locale);
    await pngToClipboard(png);
    return { ok: true, message: i18n.t("share.api.imageCopied", { note: redactNote }) };
  }

  return { ok: false, code: "UNKNOWN_ACTION", message: i18n.t("share.api.unknownAction") };
}

// ---------- HTTP ----------

function readBody(req: IncomingMessage, locale: Locale): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error(createI18n(locale).t("share.api.bodyTooLarge")));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  obj: unknown,
  headers: Record<string, string> = {},
): void {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    ...headers,
  });
  res.end(buf);
}

function sendAccessError(res: ServerResponse, status: 400 | 401 | 403, code: string): void {
  res.shouldKeepAlive = false;
  sendJson(res, status, { ok: false, code }, { "cache-control": "no-store", connection: "close" });
}

export interface ShareServer {
  url: string;
  entryUrl: string;
  closed: Promise<void>;
  isClosed(): boolean;
  close(): Promise<void>;
}

export interface ShareServerOptions {
  port?: number;
  defaultSession?: string;
  idleTimeoutMs?: number | null;
  accessToken?: string;
  locale?: Locale;
  languagePreference?: LanguagePreference;
  configHome?: string;
  systemLocaleDetector?: () => Promise<SystemLocaleResult>;
}

export async function startShareServer(opts: ShareServerOptions): Promise<ShareServer> {
  if (
    opts.idleTimeoutMs !== undefined &&
    opts.idleTimeoutMs !== null &&
    (!Number.isFinite(opts.idleTimeoutMs) ||
      opts.idleTimeoutMs <= 0 ||
      opts.idleTimeoutMs > MAX_TIMER_DELAY_MS)
  ) {
    throw new TypeError(`idleTimeoutMs must be between 1 and ${MAX_TIMER_DELAY_MS}, null, or undefined`);
  }
  if (opts.accessToken !== undefined && !isValidShareAccessToken(opts.accessToken)) {
    throw new TypeError("accessToken must be a canonical 32-byte base64url capability");
  }

  let locale = opts.locale ?? "zh-CN";
  let i18n = createI18n(locale);
  let languagePreference = opts.languagePreference ?? locale;
  const systemLocaleDetector = opts.systemLocaleDetector ?? detectSystemLocale;
  // 启动时读 config；页面设置面板经 POST /api/config 持久化并即时更新这里
  const bootCfg = await loadConfig(opts.configHome);
  let listLimit = sessionListLimit(bootCfg);
  let toolDisplay = shareToolDisplay(bootCfg);
  const idleTimeoutMs = opts.idleTimeoutMs === undefined ? IDLE_TIMEOUT_MS : opts.idleTimeoutMs;
  let idleTimer: NodeJS.Timeout | undefined;
  let closeStarted = false;
  let closedState = false;
  let resolveClosed!: () => void;
  let rejectClosed!: (reason: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  let server: Server;
  const close = (): Promise<void> => {
    if (closeStarted) return closed;
    closeStarted = true;
    closedState = true;
    if (idleTimer !== undefined) clearTimeout(idleTimer);

    if (!server.listening) {
      resolveClosed();
      return closed;
    }

    const drainTimer = setTimeout(() => {
      server.closeAllConnections();
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);
    server.close((error) => {
      clearTimeout(drainTimer);
      if (error) {
        rejectClosed(error);
        return;
      }
      resolveClosed();
    });
    return closed;
  };

  const touch = (): void => {
    if (idleTimeoutMs === null || closeStarted) return;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(i18n.t("share.server.idle"));
      void close();
    }, idleTimeoutMs);
  };

  server = createServer((req, res) => {
    const requestLocale = locale;
    const requestI18n = i18n;
    const requestLanguagePreference = languagePreference;
    void handle(req, res, requestLocale, requestI18n, requestLanguagePreference).catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      sendJson(res, 500, { ok: false, code: "INTERNAL_ERROR", message: requestI18n.t("share.api.internal") });
    });
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    requestLocale: Locale,
    requestI18n: I18n,
    requestLanguagePreference: LanguagePreference,
  ): Promise<void> {
    const requestTarget = req.url ?? "/";
    if (opts.accessToken !== undefined && !requestTarget.startsWith("/")) {
      sendAccessError(res, 400, "INVALID_REQUEST_TARGET");
      return;
    }

    let url: URL;
    try {
      url = new URL(requestTarget, "http://127.0.0.1");
    } catch (error) {
      if (opts.accessToken === undefined) throw error;
      sendAccessError(res, 400, "INVALID_REQUEST_TARGET");
      return;
    }
    const p = url.pathname;
    const method = req.method ?? "";

    if (opts.accessToken !== undefined) {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        sendAccessError(res, 401, "UNAUTHORIZED");
        return;
      }
      const expectedHost = `127.0.0.1:${address.port}`;
      const expectedOrigin = `http://${expectedHost}`;

      if (req.headers.host !== expectedHost) {
        sendAccessError(res, 400, "INVALID_HOST");
        return;
      }

      if (method === "GET" && p === "/" && url.search !== "") {
        const entries = [...url.searchParams.entries()];
        const bootstrapShapeIsValid =
          /^\?access=[A-Za-z0-9_-]{43}$/.test(url.search) &&
          entries.length === 1 &&
          entries[0]?.[0] === "access";
        const suppliedToken = entries[0]?.[1];
        if (!bootstrapShapeIsValid || !tokensEqual(suppliedToken, opts.accessToken)) {
          sendAccessError(res, 401, "UNAUTHORIZED");
          return;
        }

        res.writeHead(303, {
          location: "/",
          "set-cookie": `${shareCookieName(address.port)}=${opts.accessToken}; HttpOnly; SameSite=Strict; Path=/`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "content-length": "0",
        });
        res.end();
        return;
      }

      if (url.searchParams.has("access")) {
        sendAccessError(res, 401, "UNAUTHORIZED");
        return;
      }

      const cookieToken = readCookie(req.headers.cookie, shareCookieName(address.port));
      if (!tokensEqual(cookieToken, opts.accessToken)) {
        sendAccessError(res, 401, "UNAUTHORIZED");
        return;
      }

      if (method === "POST" && !isAllowedOrigin(req.headers.origin, expectedOrigin)) {
        sendAccessError(res, 403, "INVALID_ORIGIN");
        return;
      }
    }

    touch();

    if (method === "GET" && p === "/") {
      const html = renderPage(opts.defaultSession, toolDisplay, isMac, requestLocale, requestLanguagePreference);
      const buf = Buffer.from(html, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": buf.length });
      res.end(buf);
      return;
    }
    if (method === "GET" && p === "/api/sessions") {
      // ?ensure=<id>：前端焦点刷新时保证「当前正在看的会话」始终在列表里（可能比 limit 老）
      const ensure = url.searchParams.get("ensure") ?? opts.defaultSession;
      sendJson(res, 200, { sessions: await listSessions(listLimit, ensure ?? undefined), limit: listLimit });
      return;
    }
    if (method === "POST" && p === "/api/config") {
      const parsedBody: unknown = JSON.parse(await readBody(req, requestLocale));
      if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
        sendJson(res, 400, {
          ok: false,
          code: "INVALID_CONFIG_BODY",
          message: requestI18n.t("share.api.configBody"),
        });
        return;
      }
      const body = parsedBody as {
        language?: unknown;
        sessionListLimit?: unknown;
        toolDisplay?: unknown;
      };
      const patch: ConfigPatch = {};
      if (body.language !== undefined) {
        if (
          typeof body.language !== "string" ||
          !(LANGUAGE_PREFERENCES as readonly string[]).includes(body.language)
        ) {
          sendJson(res, 400, {
            ok: false,
            code: "INVALID_LANGUAGE",
            message: requestI18n.t("share.api.configLanguage", { values: LANGUAGE_PREFERENCES.join(" | ") }),
          });
          return;
        }
        patch.language = body.language as LanguagePreference;
      }
      if (body.sessionListLimit !== undefined) {
        if (typeof body.sessionListLimit !== "number" || !Number.isInteger(body.sessionListLimit)) {
          sendJson(res, 400, { ok: false, code: "INVALID_SESSION_LIST_LIMIT", message: requestI18n.t("share.api.configInteger") });
          return;
        }
        patch.sessionListLimit = body.sessionListLimit;
      }
      if (body.toolDisplay !== undefined) {
        if (typeof body.toolDisplay !== "string" || !(TOOL_DISPLAYS as readonly string[]).includes(body.toolDisplay)) {
          sendJson(res, 400, { ok: false, code: "INVALID_TOOL_DISPLAY", message: requestI18n.t("share.api.configToolDisplay", { values: TOOL_DISPLAYS.join(" | ") }) });
          return;
        }
        patch.toolDisplay = body.toolDisplay as ToolDisplay;
      }
      if (patch.language === undefined && patch.sessionListLimit === undefined && patch.toolDisplay === undefined) {
        sendJson(res, 400, { ok: false, code: "EMPTY_CONFIG_PATCH", message: requestI18n.t("share.api.configEmpty") });
        return;
      }
      try {
        let nextLocale: Locale | undefined;
        if (patch.language === "auto") {
          nextLocale = resolveLocale({ system: (await systemLocaleDetector()).locale });
        } else if (patch.language !== undefined) {
          nextLocale = patch.language;
        }
        const saved = await updateConfig(patch, opts.configHome);
        listLimit = saved.sessionListLimit;
        toolDisplay = saved.toolDisplay;
        if (nextLocale !== undefined) {
          languagePreference = saved.language;
          locale = nextLocale;
          i18n = createI18n(locale);
        }
        sendJson(res, 200, {
          ok: true,
          limit: listLimit,
          toolDisplay,
          language: languagePreference,
          locale,
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, code: "CONFIG_SAVE_FAILED", message: requestI18n.t("share.api.configSaveFailed") });
      }
      return;
    }
    if (method === "GET" && p.startsWith("/api/session/")) {
      const id = decodeURIComponent(p.slice("/api/session/".length));
      const detail = await loadDetail(id, parseToolDisplay(url.searchParams.get("tools")), requestLocale);
      if (!detail) {
        sendJson(res, 404, { code: "SESSION_NOT_FOUND", message: requestI18n.t("share.api.sessionNotFound") });
        return;
      }
      sendJson(res, 200, detail);
      return;
    }
    if (method === "POST" && p === "/api/export") {
      const body = JSON.parse(await readBody(req, requestLocale)) as ExportBody;
      const result = await handleExport(body, requestLocale);
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
      sendJson(res, status, { ok: result.ok, blocked: result.blocked, code: result.code, message: result.message });
      return;
    }
    if (method === "POST" && p === "/api/close") {
      res.once("finish", () => void close());
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { code: "NOT_FOUND", message: requestI18n.t("share.api.notFound") });
  }

  const port = await listen(server, opts.port);
  touch();
  const url = `http://127.0.0.1:${port}/`;
  return {
    url,
    entryUrl: opts.accessToken === undefined ? url : `${url}?access=${opts.accessToken}`,
    closed,
    isClosed: () => closedState,
    close,
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
