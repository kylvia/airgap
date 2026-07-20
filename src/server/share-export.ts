import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuleMatch, ToolDisplay, Turn } from "../types.js";
import { scanString } from "../detect/scanner.js";
import { renderHtml } from "../render/html.js";
import { renderMarkdown } from "../render/markdown.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import { redactTurns, scanTurns } from "../session.js";
import { createI18n, type Locale } from "../i18n/index.js";

export type ExportAction = "clipboard" | "save" | "download";
export type ExportFormat = "png" | "html" | "md";

export interface ExportRequest {
  sessionId: string;
  turns: readonly number[];
  action: ExportAction;
  format: ExportFormat;
  redact?: boolean;
  acceptRisk?: boolean;
  tools: ToolDisplay;
  locale: Locale;
}

export interface ExportSelection {
  turns: Turn[];
  title: string;
  date: string;
}

export interface SaveFileRequest {
  suggestedName: string;
  data: Buffer | string;
}

export interface ShareExportAdapter {
  renderPng(html: string): Promise<Buffer>;
  copyImage?(png: Buffer): Promise<void>;
  copyText?(text: string): Promise<void>;
  saveFile(request: SaveFileRequest): Promise<string | null>;
}

export type ExportOutcome = "success" | "cancelled" | "error";

export interface ExportResult {
  outcome: ExportOutcome;
  code: string;
  message: string;
  blocked?: boolean;
  bytes?: Buffer;
  filename?: string;
}

export interface ShareExportCoordinator {
  export(request: ExportRequest): Promise<ExportResult>;
  whenIdle(): Promise<void>;
}

export interface ShareExportCoordinatorOptions {
  adapter: ShareExportAdapter;
  resolveSelection(request: ExportRequest): Promise<ExportSelection | null>;
  scan?: (value: string) => RuleMatch[];
  renderHtml?: typeof renderHtml;
  renderMarkdown?: typeof renderMarkdown;
  onError?: (error: unknown) => void;
  now?: () => Date;
}

export class CliChromeMissingError extends Error {
  constructor() {
    super("Chrome/Chromium is required to render PNG exports");
    this.name = "CliChromeMissingError";
  }
}

function stamp(now: Date): string {
  const p2 = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
}

function run(command: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error) => (error ? reject(error) : resolve()));
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

async function renderPngWithChrome(html: string): Promise<Buffer> {
  const chrome = findChrome();
  if (!chrome) throw new CliChromeMissingError();
  const pngPath = path.join(os.tmpdir(), `airgap-share-${randomUUID()}.png`);
  try {
    await renderPngViaChrome(html, pngPath, chrome);
    return await readFile(pngPath);
  } finally {
    await rm(pngPath, { force: true }).catch(() => {});
  }
}

async function copyPngWithAppleScript(png: Buffer): Promise<void> {
  const pngPath = path.join(os.tmpdir(), `airgap-share-${randomUUID()}.png`);
  try {
    await writeFile(pngPath, png);
    const script = `set the clipboard to (read (POSIX file "${pngPath}") as «class PNGf»)`;
    await run("osascript", ["-e", script]);
  } finally {
    await rm(pngPath, { force: true }).catch(() => {});
  }
}

export function createCliExportAdapter(): ShareExportAdapter {
  const adapter: ShareExportAdapter = {
    renderPng: renderPngWithChrome,
    async saveFile(request) {
      if (
        request.suggestedName.length === 0 ||
        path.basename(request.suggestedName) !== request.suggestedName ||
        request.suggestedName === "." ||
        request.suggestedName === ".."
      ) {
        throw new Error("Invalid export filename");
      }
      const desktop = process.env["XDG_DESKTOP_DIR"] || path.join(os.homedir(), "Desktop");
      await mkdir(desktop, { recursive: true });
      const desktopRoot = path.resolve(desktop);
      const outPath = path.resolve(desktopRoot, request.suggestedName);
      if (path.dirname(outPath) !== desktopRoot) throw new Error("Invalid export filename");
      if (typeof request.data === "string") await writeFile(outPath, request.data, "utf8");
      else await writeFile(outPath, request.data);
      return outPath;
    },
  };
  if (process.platform === "darwin") {
    adapter.copyImage = copyPngWithAppleScript;
    adapter.copyText = async (text) => run("pbcopy", [], text);
  }
  return adapter;
}

export function exportBlockReason(
  turns: Turn[],
  acceptRisk: boolean | undefined,
  scan: (value: string) => RuleMatch[] = scanString,
  locale: Locale = "zh-CN",
): string | null {
  if (acceptRisk) return null;
  const findings = scanTurns(turns, scan);
  if (findings.length === 0) return null;
  const brief = findings.slice(0, 5).map((finding) => `${finding.ruleId} ${finding.preview}`).join("、");
  const i18n = createI18n(locale);
  return i18n.t("share.api.exportRisk", {
    count: findings.length,
    brief,
    more: findings.length > 5 ? i18n.t("share.api.more") : "",
  });
}

export function exportHttpStatus(result: ExportResult): number {
  if (result.outcome !== "error") return 200;
  if (result.blocked) return 409;
  if (["EXPORT_RENDER_FAILED", "EXPORT_CAPTURE_FAILED", "EXPORT_CLIPBOARD_FAILED", "EXPORT_SAVE_FAILED"].includes(result.code)) return 500;
  return 400;
}

function errorResult(code: string, message: string, blocked = false): ExportResult {
  return { outcome: "error", code, message, ...(blocked ? { blocked: true } : {}) };
}

export function createShareExportCoordinator(options: ShareExportCoordinatorOptions): ShareExportCoordinator {
  const scan = options.scan ?? scanString;
  const htmlRenderer = options.renderHtml ?? renderHtml;
  const markdownRenderer = options.renderMarkdown ?? renderMarkdown;
  const now = options.now ?? (() => new Date());
  let active = 0;
  let idleWaiters: Array<() => void> = [];

  const report = (error: unknown): void => options.onError?.(error);
  const finish = (): void => {
    active -= 1;
    if (active !== 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const renderFailure = (error: unknown, locale: Locale): ExportResult => {
    report(error);
    return errorResult("EXPORT_RENDER_FAILED", createI18n(locale).t("share.api.internal"));
  };

  async function perform(request: ExportRequest): Promise<ExportResult> {
    const i18n = createI18n(request.locale);
    const selection = await options.resolveSelection(request);
    if (!selection || selection.turns.length === 0) {
      return errorResult("NO_TURNS_SELECTED", i18n.t("share.api.noSelection"));
    }

    let turns = selection.turns;
    let title = selection.title;
    const titleTurn: Turn = { index: -1, userText: title, timestamp: null, assistant: [] };
    let redactNote = "";
    if (request.redact) {
      const redacted = redactTurns([titleTurn, ...turns], scan);
      title = redacted.turns[0]!.userText;
      turns = redacted.turns.slice(1);
      if (redacted.count > 0) redactNote = i18n.t("share.api.redactedNote", { count: redacted.count });
    } else {
      const reason = exportBlockReason([titleTurn, ...turns], request.acceptRisk, scan, request.locale);
      if (reason) return errorResult("EXPORT_SECRET_RISK", reason, true);
    }

    const basename = `airgap-share-${stamp(now())}`;
    const renderHtmlData = (): string => htmlRenderer(
      turns,
      { title, date: selection.date },
      { tools: request.tools, locale: request.locale },
    );
    const renderMarkdownData = (): string => markdownRenderer(
      turns,
      { title, date: selection.date },
      { tools: request.tools, locale: request.locale },
    );
    const capture = async (): Promise<Buffer | ExportResult> => {
      let html: string;
      try {
        html = renderHtmlData();
      } catch (error) {
        return renderFailure(error, request.locale);
      }
      try {
        return await options.adapter.renderPng(html);
      } catch (error) {
        report(error instanceof CliChromeMissingError
          ? new Error(i18n.t("share.api.chromeMissing"))
          : error);
        return errorResult("EXPORT_CAPTURE_FAILED", i18n.t("share.api.internal"));
      }
    };

    if (request.action === "download") {
      const png = await capture();
      if (!Buffer.isBuffer(png)) return png;
      return {
        outcome: "success",
        code: "EXPORT_DOWNLOAD",
        message: "download",
        bytes: png,
        filename: `${basename}.png`,
      };
    }

    if (request.action === "clipboard") {
      if (request.format === "md") {
        if (!options.adapter.copyText) return errorResult("CLIPBOARD_UNSUPPORTED", i18n.t("share.api.clipboardMacOnly"));
        let text: string;
        try {
          text = renderMarkdownData();
        } catch (error) {
          return renderFailure(error, request.locale);
        }
        try {
          await options.adapter.copyText(text);
        } catch (error) {
          report(error);
          return errorResult("EXPORT_CLIPBOARD_FAILED", i18n.t("share.api.internal"));
        }
        return { outcome: "success", code: "TEXT_COPIED", message: i18n.t("share.api.markdownCopied", { note: redactNote }) };
      }
      if (!options.adapter.copyImage) return errorResult("CLIPBOARD_UNSUPPORTED", i18n.t("share.api.clipboardMacOnly"));
      const png = await capture();
      if (!Buffer.isBuffer(png)) return png;
      try {
        await options.adapter.copyImage(png);
      } catch (error) {
        report(error);
        return errorResult("EXPORT_CLIPBOARD_FAILED", i18n.t("share.api.internal"));
      }
      return { outcome: "success", code: "IMAGE_COPIED", message: i18n.t("share.api.imageCopied", { note: redactNote }) };
    }

    if (request.action === "save") {
      let data: Buffer | string;
      if (request.format === "png") {
        const png = await capture();
        if (!Buffer.isBuffer(png)) return png;
        data = png;
      } else {
        try {
          data = request.format === "html" ? renderHtmlData() : renderMarkdownData();
        } catch (error) {
          return renderFailure(error, request.locale);
        }
      }
      try {
        const savedPath = await options.adapter.saveFile({ suggestedName: `${basename}.${request.format}`, data });
        if (savedPath === null) return { outcome: "cancelled", code: "EXPORT_CANCELLED", message: "" };
        return {
          outcome: "success",
          code: "EXPORT_SAVED",
          message: i18n.t("share.api.saved", { path: savedPath, note: redactNote }),
        };
      } catch (error) {
        report(error);
        return errorResult("EXPORT_SAVE_FAILED", i18n.t("share.api.internal"));
      }
    }

    return errorResult("UNKNOWN_ACTION", i18n.t("share.api.unknownAction"));
  }

  return {
    export(request) {
      active += 1;
      return perform(request).finally(finish);
    },
    whenIdle() {
      if (active === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}
