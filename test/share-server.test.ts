import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleMatch, Turn } from "../src/types.js";
import { createShareAccessToken, shareCookieName } from "../src/server/share-access.js";
import { desktopProjectLabel, exportBlockReason, startShareServer } from "../src/server/share-server.js";
import type { ShareExportAdapter } from "../src/server/share-export.js";
import { renderPage, serializeForScript } from "../src/server/page.js";

const scan = (s: string): RuleMatch[] =>
  s.includes("sk-ant-LEAK")
    ? [{ ruleId: "anthropic-key", severity: "critical", secret: "sk-ant-LEAK", preview: "sk-a…LEAK" }]
    : [];

const tempHomes: string[] = [];

async function tempHome(config?: string): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "airgap-share-language-"));
  tempHomes.push(home);
  if (config !== undefined) {
    await mkdir(path.join(home, ".airgap"), { recursive: true });
    await writeFile(path.join(home, ".airgap", "config.json"), config, "utf8");
  }
  return home;
}

async function tempHomeWithClaudeSession(): Promise<{ home: string; sessionId: string }> {
  const home = await tempHome();
  const sessionId = "s-claude-mini";
  const projectDir = path.join(home, ".claude", "projects", "-tmp-demo");
  await mkdir(projectDir, { recursive: true });
  const fixture = await readFile(new URL("./fixtures/claude-mini.jsonl", import.meta.url), "utf8");
  await writeFile(path.join(projectDir, `${sessionId}.jsonl`), fixture, "utf8");
  return { home, sessionId };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function responseHeadForRawRequest(port: number, request: string): Promise<string> {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write(request);

  return new Promise<string>((resolve, reject) => {
    let received = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for HTTP response headers"));
    }, 1_000);
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      const end = received.indexOf("\r\n\r\n");
      if (end === -1) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(received.slice(0, end + 4));
    });
    socket.on("close", () => {
      if (!received.includes("\r\n\r\n")) {
        clearTimeout(timeout);
        reject(new Error("connection closed before HTTP response headers"));
      }
    });
  });
}

async function bootstrapCookie(entryUrl: string): Promise<{ response: Response; cookie: string }> {
  const response = await fetch(entryUrl, { redirect: "manual" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("bootstrap response did not set a cookie");
  return { response, cookie: setCookie.split(";", 1)[0] ?? "" };
}

/** A tool turn whose only secret (if any) sits in the requested slot; summary/user text stay clean. */
function toolTurn(secretIn: "input" | "result" | "none"): Turn {
  return {
    index: 1,
    userText: "run it",
    timestamp: null,
    assistant: [
      {
        kind: "tool",
        text: "Bash: run",
        toolName: "Bash",
        toolInput: secretIn === "input" ? "export K=sk-ant-LEAK" : "run",
        toolResult: secretIn === "result" ? "K=sk-ant-LEAK" : "ok",
      },
    ],
  };
}

describe("exportBlockReason (share server-side export gate)", () => {
  it("blocks a secret hiding in a tool result when acceptRisk is not set", () => {
    expect(exportBlockReason([toolTurn("result")], undefined, scan)).toMatch(/疑似密钥/);
  });

  it("blocks a secret in a tool input too", () => {
    expect(exportBlockReason([toolTurn("input")], false, scan)).not.toBeNull();
  });

  it("allows export when the caller explicitly accepts the risk", () => {
    expect(exportBlockReason([toolTurn("result")], true, scan)).toBeNull();
  });

  it("allows clean content through", () => {
    expect(exportBlockReason([toolTurn("none")], false, scan)).toBeNull();
  });

  it("localizes the server-side risk response", () => {
    expect(exportBlockReason([toolTurn("result")], false, scan, "en")).toMatch(/1 possible secret\b/i);
  });
});

describe("renderPage (share picker shell)", () => {
  const page = renderPage();

  it("renders settings as one accessible modal dialog on both surfaces", () => {
    for (const surface of ["browser", "desktop"] as const) {
      const rendered = renderPage(undefined, "summary", true, "en", "en", surface, "0.3.0");
      expect(rendered).toContain('<dialog id="prefpanel" tabindex="-1" aria-labelledby="settings-title">');
      expect(rendered).toContain('<h2 id="settings-title">Settings</h2>');
      expect(rendered).toContain('id="prefclose"');
      expect(rendered).toContain('aria-label="Close settings"');
      expect(rendered).toContain('aria-expanded="false" aria-controls="prefpanel"');
    }
  });

  it("loading overlay 锚点在位：切会话/切档时盖住内容区，动画尊重 reduced-motion", () => {
    expect(page).toContain('id="loading"');
    expect(page).toContain("gap-pulse");
    expect(page).toContain("prefers-reduced-motion");
  });

  it("预览 iframe 文档带 <base target=_blank>：点会话内容里的链接开新标签，iframe 不被导航走", () => {
    expect(page).toContain('<base target="_blank">');
  });

  it("关键 DOM/JS 锚点齐全（design.md 清单）", () => {
    for (const id of ["sess", "sbanner", "list", "preview", "status", "count", "all", "none", "done", "tools", "language", "redact", "loading", "limit", "sid", "prefs", "prefpanel"]) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).toContain('data-a="clipboard"');
  });

  it("Dossier 铁律：无 backdrop-filter、色值走 token、HTML-UI 零 emoji", () => {
    expect(page).not.toContain("backdrop-filter");
    expect(page).toContain("var(--bg-subtle)");
    expect(page).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("renders an unclipped accessible bilingual Tool display tooltip", () => {
    const zh = renderPage(undefined, "summary", true, "zh-CN");
    expect(zh).toContain('id="tool-help-trigger"');
    expect(zh).toContain('type="button"');
    expect(zh).toContain('aria-label="工具展示说明"');
    expect(zh).toContain('aria-describedby="tool-help"');
    expect(zh).toContain('id="tool-help" role="tooltip"');
    expect(zh).toContain("完全不展示工具调用。");
    expect(zh).toContain("展示工具名、关键参数和执行状态。");
    expect(zh).toContain("富文本预览中展示输入与结果摘要；Markdown 和检索类工具仍使用摘要。");
    expect(zh).toContain(".tool-help-wrap:hover .tool-help-tooltip");
    expect(zh).toContain(".tool-help-wrap:focus-within .tool-help-tooltip");
    expect(zh).toContain("top: calc(100% + 7px); right: -4px;");
    expect(zh).toContain("#prefpanel:has(.tool-help-wrap:hover),");
    expect(zh).toContain("#prefpanel:has(.tool-help-wrap:focus-within) { overflow: visible; }");

    const en = renderPage(undefined, "summary", true, "en");
    expect(en).toContain('aria-label="About tool display"');
    expect(en).toContain("Omits tool calls completely.");
    expect(en).toContain("Shows the tool name, key argument, and execution status.");
    expect(en).toContain("Shows input and result excerpts in rich previews; Markdown and search tools still use summaries.");
  });
});

describe("renderPage desktop surface", () => {
  const page = renderPage(undefined, "summary", true, "en", "en", "desktop", "0.3.0");

  it("renders the approved single-window Share controls with stable test anchors", () => {
    expect(page).toContain('data-surface="desktop"');
    for (const testId of [
      "conversation-picker",
      "refresh",
      "turn-list",
      "preview",
      "redaction-toggle",
      "copy-text",
      "save-image",
      "copy-image",
      "settings",
      "empty-state",
    ]) {
      expect(page).toContain(`data-testid="${testId}"`);
    }
    expect(page).toContain("Share conversation");
    expect(page).toContain("Automatically hide possible secrets");
    expect(page).toContain(">Copy text</button>");
    expect(page).toContain(">Save image</button>");
    expect(page).toMatch(/<button class="primary"[^>]*data-testid="copy-image"[^>]*>Copy image<\/button>/);
  });

  it("keeps browser-only implementation details out of desktop markup", () => {
    expect(page).not.toContain('id="sid"');
    expect(page).not.toContain('id="done"');
    expect(page).not.toContain("claude --resume");
    expect(page).not.toContain("codex resume");
    expect(page).not.toContain("~/.airgap/config.json");
    expect(page).not.toContain(">Done</button>");
  });

  it("uses session titles with project fallback and keeps tool controls under Advanced", () => {
    expect(page).toContain('source === "claude" ? "Claude Code" : "Codex"');
    expect(page).toContain('msg("share.desktop.conversationLabel", { title: s.title || s.project, provider: providerName(s.source), time: rel(s.mtimeMs) })');
    expect(page).toMatch(/<details[^>]*>[\s\S]*<summary>Advanced<\/summary>[\s\S]*id="tools"[\s\S]*<\/details>/);
    expect(page).toContain('msg("share.desktop.role.me")');
    expect(page).toContain('msg("share.desktop.role.assistant")');
    expect(page).toContain('msg("share.desktop.role.tool")');
  });

  it("renders nontechnical empty, permission, image failure, and About copy", () => {
    expect(page).toContain("Airgap looks for Claude Code and Codex conversations on this Mac");
    expect(page).toContain("Airgap does not upload your conversations and does not require an account");
    expect(page).toContain('msg("share.desktop.permissionError"');
    expect(page).toContain("Image export failed. Your selection is unchanged, and you can still copy text.");
    expect(page).toContain("0.3.0");
    expect(page).toContain('href="https://github.com/kylvia/airgap"');
    expect(page).toContain('href="https://github.com/kylvia/airgap/releases"');
  });

  it("preserves the shared state machine and current selection across refresh/export failures", () => {
    expect(page).toContain('if (!r.ok) return "failed"');
    expect(page).toContain("const selected = new Set()");
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    expect(refresh.indexOf("fillOptions")).toBeGreaterThan(refresh.indexOf('if (!r.ok) return "failed"'));
    const exportHandler = page.slice(page.indexOf("async function doExport"), page.indexOf("for (const btn"));
    expect(exportHandler).not.toContain("selected.clear()");
  });

  it("rolls the picker back and keeps export disabled when a session switch fails", () => {
    const load = page.slice(page.indexOf("async function loadSession("), page.indexOf("function renderList"));
    expect(load).toContain("const previousId = detail ? detail.id : null");
    expect(load).toContain('beginInteraction("load")');
    expect(load).toContain('if (previousId) $("sess").value = previousId');
    expect(load).toContain('endInteraction("load")');
    expect(page).toContain('document.querySelectorAll("footer button[data-a]")');
    expect(page).toContain("button.disabled = busy || !detail");
  });

  it("treats desktop discovery diagnostics as a transactional refresh failure", () => {
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    expect(refresh).toContain('if (SURFACE === "desktop" && detail && data.issues && data.issues.length > 0)');
    expect(refresh).toContain('return "diagnostic"');
    expect(refresh.indexOf("return \"diagnostic\"")).toBeLessThan(refresh.indexOf("fillOptions"));
    const manual = page.slice(page.indexOf("async function refreshCurrentSession"), page.indexOf('$("refresh").onclick'));
    expect(manual).toContain('refreshResult === "diagnostic"');
    expect(manual).toContain('if (refreshResult === "failed")');
  });

  it("replaces a vanished current conversation without mixing picker and preview state", () => {
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    expect(refresh).toContain('!data.sessions.some((session) => session.id === detail.id)');
    expect(refresh).toContain('setStatus(msg("share.desktop.currentUnavailable"), true)');
    expect(refresh).toContain("clearCurrentConversation()");
    expect(refresh).toContain("fillOptions(data.sessions, null)");
    expect(refresh).toContain("showDiscoveryState(data.sessions, data.issues || [])");
    expect(refresh).toContain("const replacement = data.sessions[0]");
    expect(refresh).toContain("await loadSession(replacement.id)");
    expect(refresh).toContain('return "replaced"');
    expect(refresh.indexOf("clearCurrentConversation()")).toBeLessThan(refresh.indexOf("fillOptions(data.sessions, null)"));

    const manual = page.slice(page.indexOf("async function refreshCurrentSession"), page.indexOf('$("refresh").onclick'));
    expect(manual).toContain('refreshResult === "replaced"');
    expect(refresh).toContain('if (!foreground && currentMissing) return "stale"');
    expect(page).toContain("refreshSessionsAfterResume()");
  });

  it("clears selection, preview, and export state before accepting a replacement list", () => {
    const clear = page.slice(page.indexOf("function clearCurrentConversation"), page.indexOf("async function refreshSessions"));
    expect(clear).toContain("detail = null");
    expect(clear).toContain("selected.clear()");
    expect(clear).toContain("pvReady = false");
    expect(clear).toContain('$("list").innerHTML = ""');
    expect(clear).toContain('const preview = $("preview")');
    expect(clear).toContain('preview.srcdoc = ""');
    expect(clear).toContain("renderInteractionState()");
  });

  it("keeps partial-provider diagnostics visible after a successful initial load", () => {
    expect(page).toContain("let discoveryIssueMessage = null");
    const discovery = page.slice(page.indexOf("function showDiscoveryState"), page.indexOf("function showStartupError"));
    expect(discovery).toContain("discoveryIssueMessage = issue ? discoveryDiagnostic(issue) : null");
    const load = page.slice(page.indexOf("async function loadSession("), page.indexOf("function renderList"));
    expect(load).toContain("if (discoveryIssueMessage) setStatus(discoveryIssueMessage, true)");
  });

  it("reports refresh diagnostics without replacing an existing preview with the empty overlay", () => {
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    const diagnostic = refresh.slice(refresh.indexOf('if (SURFACE === "desktop" && detail && data.issues'));
    expect(diagnostic).toContain("discoveryIssueMessage = discoveryDiagnostic(data.issues[0])");
    expect(diagnostic).toContain("setStatus(discoveryIssueMessage, true)");
    expect(diagnostic.slice(0, diagnostic.indexOf('return "diagnostic"'))).not.toContain("showDiscoveryState");
  });

  it("loads the first conversation when Recheck finds conversations after an empty start", () => {
    expect(page).toContain('if (SURFACE === "desktop" && $("sess").value)');
    expect(page).toContain('await loadSession($("sess").value)');
  });

  it("maps desktop export feedback without exposing backend implementation details", () => {
    expect(page).not.toContain('id="image-failure-copy"');
    expect(page).toContain("function desktopExportMessage(action, format, ok, code)");
    expect(page).toContain('code === "EXPORT_IMAGE_TOO_LARGE"');
    expect(page).toContain('msg("share.desktop.imageTooLarge")');
    expect(page).toContain('code === "EXPORT_CAPTURE_FAILED"');
    expect(page).toContain('msg("share.desktop.imageFailed")');
    expect(page).toContain('code === "EXPORT_CLIPBOARD_FAILED"');
    expect(page).toContain('code === "EXPORT_SAVE_FAILED"');
    expect(page).toContain('action === "clipboard" && format === "md"');
    expect(page).toContain('msg(ok ? "share.desktop.copyTextSuccess" : "share.desktop.copyTextFailed")');
    expect(page).toContain('msg(ok ? "share.desktop.copyImageSuccess" : "share.desktop.copyImageFailed")');
    expect(page).toContain('msg(ok ? "share.desktop.saveImageSuccess" : "share.desktop.saveImageFailed")');
    const exportHandler = page.slice(page.indexOf("async function doExport"), page.indexOf("for (const btn"));
    expect(exportHandler).toContain("confirm(res.message");
    expect(exportHandler).toContain("desktopExportMessage(action, format, res.ok, res.code) || res.message");
    expect(exportHandler).toContain("desktopExportMessage(action, format, false)");
  });

  it("guides oversized image exports to Copy text after restoring the controls", () => {
    const zh = renderPage(undefined, "none", true, "zh-CN", "zh-CN", "desktop", "0.3.0");
    expect(zh).toContain("点击“复制文本”导出全部已选内容");
    expect(page).toContain("let focusCopyTextAfterExport = false");

    const exportHandler = page.slice(page.indexOf("async function doExport"), page.indexOf("for (const btn"));
    expect(exportHandler).toContain('res.code === "EXPORT_IMAGE_TOO_LARGE"');
    expect(exportHandler).toContain("focusCopyTextAfterExport = true");
    expect(exportHandler).toContain('document.querySelector(\'footer button[data-a="clipboard"][data-f="md"]\')?.focus()');
    expect(exportHandler.indexOf('endInteraction("export")')).toBeLessThan(
      exportHandler.indexOf("focusCopyTextAfterExport = false"),
    );
  });

  it("treats a native save cancellation as neither success nor failure", () => {
    const exportHandler = page.slice(page.indexOf("async function performExport"), page.indexOf("for (const btn"));
    expect(exportHandler).toContain('if (res.code === "EXPORT_CANCELLED") { setStatus(msg("share.page.cancelled")); return; }');
  });

  it("serializes export actions and restores controls in finally", () => {
    expect(page).toContain("let exportInFlight = false");
    const exportHandler = page.slice(page.indexOf("async function doExport"), page.indexOf("for (const btn"));
    expect(exportHandler).toContain("if (exportInFlight) return");
    expect(exportHandler).toContain("exportInFlight = true");
    expect(exportHandler).toContain('beginInteraction("export")');
    expect(exportHandler).toContain("finally");
    expect(exportHandler).toContain("exportInFlight = false");
    expect(exportHandler).toContain('endInteraction("export")');
    expect(exportHandler).toContain("return performExport(action, format, true)");
  });

  it("does not treat redaction as acceptance of unscannable image risk", () => {
    const exportHandler = page.slice(page.indexOf("async function performExport"), page.indexOf("for (const btn"));
    expect(exportHandler).toContain("const accept = !!acceptRisk || (!redact && risky.length > 0)");
  });

  it("uses generic desktop settings failures instead of server paths", () => {
    expect(page).toContain('function desktopSettingsError() { return msg("share.desktop.settingsSaveFailed"); }');
    expect(page).toContain('SURFACE === "desktop" ? desktopSettingsError() : res.message');
  });

  it("labels desktop controls and preserves the browser selection controls", () => {
    expect(page).toMatch(/<select id="sess"[^>]*aria-label="Conversation"[^>]*disabled/);
    expect(page).toMatch(/<select id="language"[^>]*aria-label="Language"/);
    expect(page).toMatch(/<select id="limit"[^>]*aria-label="Conversation list size"/);
    expect(page).toMatch(/<select id="tools"[^>]*aria-label="Tool display"/);
    expect(page).toContain('<iframe id="preview" data-testid="preview" title="Conversation preview"></iframe>');
    expect(page).toContain('<button type="button" id="all" disabled>Select all</button>');
    expect(page).toContain('<button type="button" id="none" disabled>Clear</button>');

    const browser = renderPage(undefined, "summary", true, "en", "en", "browser");
    expect(browser).toContain('<a id="all">Select all</a><a id="none">Clear</a>');
  });

  it("announces status and focuses surfaced errors", () => {
    expect(page).toContain('id="status" role="status" aria-live="polite"');
    expect(page).toContain('id="empty-state" data-testid="empty-state" tabindex="-1"');
    expect(page).toContain("state.focus()");
  });

  it("opens and closes the modal while restoring settings-button focus", () => {
    expect(page).toContain('aria-expanded="false" aria-controls="prefpanel"');
    expect(page).toContain("function openPreferences() {");
    expect(page).toContain("panel.showModal()");
    expect(page).toContain("panel.focus()");
    expect(page).toContain('button.setAttribute("aria-expanded", "true")');
    expect(page).toContain("function closePreferences() {");
    expect(page).toContain("if (panel.open) panel.close()");
    expect(page).toContain('$("prefclose").onclick = closePreferences');
    expect(page).toContain("if (event.target === panel) closePreferences()");
    expect(page).toContain('panel.addEventListener("close", () => {');
    expect(page).toContain('button.setAttribute("aria-expanded", "false")');
    expect(page).toContain("button.focus()");
    expect(page).not.toContain("setPreferencesOpen(");
    expect(page).not.toContain('document.addEventListener("click"');
  });

  it("defers focus restoration until a settings interaction has re-enabled the trigger", () => {
    expect(page).toContain("let pendingPreferencesFocusRestore = false");
    expect(page).toContain("if (button.disabled) {");
    expect(page).toContain("pendingPreferencesFocusRestore = true");
    expect(page).toContain("if (!busy && !panel.open && pendingPreferencesFocusRestore) {");
    expect(page).toContain("pendingPreferencesFocusRestore = false");
    expect(page).toContain("button.focus()");
  });

  it("mirrors settings feedback into a live region inside the open modal", () => {
    expect(page).toContain('<p id="settings-status" class="status" role="status" aria-live="polite"></p>');
    expect(page).toContain('const className = "status" + (err ? " err" : "")');
    expect(page).toContain("if (panel.open) {");
    expect(page).toContain('const dialogStatus = $("settings-status")');
    expect(page).toContain("dialogStatus.textContent = msg");
    expect(page).toContain("dialogStatus.className = className");
  });

  it("starts desktop picker and export actions disabled and restores them from shared state", () => {
    expect(page).toMatch(/<button[^>]*data-testid="copy-text"[^>]*disabled/);
    expect(page).toMatch(/<button[^>]*data-testid="save-image"[^>]*disabled/);
    expect(page).toMatch(/<button[^>]*data-testid="copy-image"[^>]*disabled/);
    expect(page).toContain("picker.disabled = busy || picker.options.length === 0");
    expect(page).toContain("button.disabled = busy || !detail");
  });

  it("derives one busy state from all overlapping in-flight operations", () => {
    expect(page).toContain('const inFlight = { bootstrap: 0, refresh: 0, load: 0, export: 0, settings: 0 }');
    expect(page).toContain("Object.values(inFlight).some((count) => count > 0)");
    expect(page).toContain("function beginInteraction(kind)");
    expect(page).toContain("function endInteraction(kind)");
    expect(page).toContain("inFlight[kind] += 1");
    expect(page).toContain("inFlight[kind] = Math.max(0, inFlight[kind] - 1)");
    expect(page).toContain('$("refresh").disabled = busy');
    expect(page).toContain('$("prefs").disabled = busy');
    expect(page).toContain('$("redact").disabled = busy');
    expect(page).toContain('for (const id of ["limit", "tools", "language"])');
    expect(page).toContain('for (const checkbox of document.querySelectorAll("#list input[type=checkbox]"))');
  });

  it("does not let a session load unlock controls while an export remains in flight", () => {
    const load = page.slice(page.indexOf("async function loadSession("), page.indexOf("function renderList"));
    expect(load).toContain('beginInteraction("load")');
    expect(load).toContain('endInteraction("load")');
    expect(load).not.toContain("setInteractionBusy(false)");
    expect(page).toContain("Object.values(inFlight).some((count) => count > 0)");
  });

  it("keeps refresh and settings operations inside the shared busy lifecycle", () => {
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    expect(refresh).toContain('beginInteraction("refresh")');
    expect(refresh).toContain('endInteraction("refresh")');
    for (const handler of [
      page.slice(page.indexOf('$("limit").onchange'), page.indexOf("const resumeEvent")),
      page.slice(page.indexOf('$("tools").onchange'), page.indexOf('$("language").onchange')),
      page.slice(page.indexOf('$("language").onchange'), page.indexOf("loadSessions();")),
    ]) {
      expect(handler).toContain('beginInteraction("settings")');
      expect(handler).toContain('endInteraction("settings")');
      expect(handler).toContain("finally");
    }
  });

  it("never treats iframe focus transitions as an app or tab resume", () => {
    expect(page).toContain('const resumeEvent = SURFACE === "desktop" ? "airgap-native-focus" : "visibilitychange"');
    expect(page).toContain("window.addEventListener(resumeEvent, () => {");
    expect(page).toContain('if (resumeEvent === "visibilitychange" && document.visibilityState !== "visible") return');
    expect(page).not.toContain('window.addEventListener("focus", () => {');
  });

  it("refreshes resumed apps in the background without disabling controls", () => {
    const refresh = page.slice(page.indexOf("async function refreshSessions"), page.indexOf("let manualRefreshInFlight"));
    expect(refresh).toContain('if (foreground) beginInteraction("refresh")');
    expect(refresh).toContain('if (!foreground && interactionBusy()) return "stale"');
    expect(refresh).toContain('if (!foreground && currentMissing) return "stale"');
    expect(refresh).toContain('if (foreground) endInteraction("refresh")');

    const resume = page.slice(page.indexOf("let resumeRefreshInFlight"), page.indexOf("function rel"));
    expect(resume).toContain("if (resumeRefreshInFlight || interactionBusy()) return");
    expect(resume).toContain("resumeRefreshInFlight = true");
    expect(resume).toContain("await refreshSessions({ foreground: false })");
    expect(resume).toContain("resumeRefreshInFlight = false");
    expect(resume).not.toContain('beginInteraction("refresh")');
  });

  it("keeps selection controls out of the tab order while no conversation is loaded", () => {
    expect(page).toContain('<button type="button" id="all" disabled>Select all</button>');
    expect(page).toContain('<button type="button" id="none" disabled>Clear</button>');
    expect(page).toContain("function setSelectionControlsDisabled(disabled)");
    expect(page).toContain('for (const id of ["all", "none"])');
    expect(page).toContain("control.disabled = disabled");
    expect(page).toContain("setSelectionControlsDisabled(busy || !detail)");
    expect(page).toContain("setSelectionControlsDisabled(visible || !detail)");
    expect(page).toContain('$("all").onclick = () => { if (!detail || interactionBusy()) return;');
    expect(page).toContain('$("none").onclick = () => { if (!detail || interactionBusy()) return;');
    expect(page).toContain('body[data-surface="desktop"] footer button:disabled');
  });

  it("uses conversation terminology throughout desktop-only visible copy", () => {
    expect(page).toContain(">Conversation list</span>");
    const manual = page.slice(page.indexOf("async function refreshCurrentSession"), page.indexOf('$("refresh").onclick'));
    const load = page.slice(page.indexOf("async function loadSession("), page.indexOf("function renderList"));
    expect(manual).toContain('"share.desktop.conversationRefreshed"');
    expect(manual).toContain('"share.desktop.refreshListFailed"');
    expect(load).toContain('"share.desktop.loadFailed"');
    expect(page).not.toContain(">Session list</span>");
  });

  it("defaults Share pages to hidden tools while preserving explicit summary", () => {
    const defaultPage = renderPage();
    const summaryPage = renderPage(undefined, "summary");

    expect(defaultPage).toBe(renderPage(undefined, "none", true, "zh-CN", "zh-CN", "browser", "9.9.9"));
    expect(defaultPage).toContain('<option value="none" selected>');
    expect(summaryPage).toContain('<option value="summary" selected>');
    expect(defaultPage).toContain('id="done"');
    expect(defaultPage).toContain("claude --resume");
    expect(defaultPage).not.toContain("9.9.9");
  });
});

describe("desktopProjectLabel", () => {
  const id = "019aaaaa-bbbb-4ccc-8ddd-eeeeffff0001";

  it("replaces raw Claude and rollout identifiers with localized conversation labels", () => {
    expect(desktopProjectLabel(`project-${id}`, "claude", id, "en")).toBe("Claude Code conversation");
    expect(desktopProjectLabel(`rollout-2026-07-20-${id}`, "codex", id, "en")).toBe("Codex conversation");
    expect(desktopProjectLabel(id, "codex", id, "zh-CN")).toBe("Codex 对话");
  });

  it("keeps a normal project basename", () => {
    expect(desktopProjectLabel("airgap", "claude", id, "en")).toBe("airgap");
  });

  it("hides Claude's munged project path when no reliable cwd was discovered", () => {
    expect(desktopProjectLabel("-Users-alice-client-work", "claude", id, "en", false))
      .toBe("Claude Code conversation");
  });
});

describe("renderPage internationalization", () => {
  it("renders an English picker with matching document and browser locale", () => {
    const page = renderPage(undefined, "summary", true, "en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Share session turns");
    expect(page).toContain('title="Refresh session data"');
    expect(page).toContain(">Copy image</button>");
    expect(page).toContain('const LOCALE = "en";');
    expect(page).not.toContain("分享会话片段");
  });

  it("escapes strings before embedding them in an inline script", () => {
    expect(serializeForScript({ value: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(serializeForScript({ value: "</script>" })).toContain("\\u003c/script>");
  });

  it("renders a localized language preference selector and reload flow", () => {
    const page = renderPage(undefined, "summary", true, "en", "auto");
    expect(page).toContain('id="language"');
    expect(page).toMatch(/<option value="auto" selected>Follow system<\/option>/);
    expect(page).toContain('<option value="zh-CN">Simplified Chinese</option>');
    expect(page).toContain('<option value="en">English</option>');
    expect(page).toContain('JSON.stringify({ language: $("language").value })');
    expect(page).toContain("window.location.reload()");
    expect(page).toContain("select.value = LANGUAGE_PREFERENCE");
    const handler = page.slice(
      page.indexOf('$("language").onchange'),
      page.indexOf('$("done").onclick'),
    );
    expect(handler).toContain('const select = $("language")');
    expect(handler).toContain('beginInteraction("settings")');
    expect(handler).toContain("try {");
    expect(handler).toContain("} catch {");
    expect(handler).toContain("select.value = LANGUAGE_PREFERENCE");
    expect(handler).toContain('endInteraction("settings")');
  });

  it("selects the current explicit Chinese preference", () => {
    const page = renderPage(undefined, "summary", true, "zh-CN", "zh-CN");
    expect(page).toContain('<option value="zh-CN" selected>简体中文</option>');
    expect(page).toContain('<option value="auto">跟随系统</option>');
    expect(page).toContain('<option value="en">英文</option>');
  });
});

describe("Share server locale wiring", () => {
  it("uses the saved boot language when a desktop caller omits locale options", async () => {
    const home = await tempHome('{"language":"en"}');
    const server = await startShareServer({
      surface: "desktop",
      idleTimeoutMs: null,
      configHome: home,
      systemLocaleDetector: async () => ({ locale: "zh-CN", source: "test system" }),
    });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('<html lang="en">');
      expect(page).toContain('<option value="en" selected>English</option>');
    } finally {
      await server.close();
    }
  });

  it("uses the system boot language as an automatic desktop preference", async () => {
    const server = await startShareServer({
      surface: "desktop",
      idleTimeoutMs: null,
      configHome: await tempHome(),
      systemLocaleDetector: async () => ({ locale: "en-US", source: "test system" }),
    });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('<html lang="en">');
      expect(page).toContain('<option value="auto" selected>Follow system</option>');
    } finally {
      await server.close();
    }
  });

  it("passes desktop surface and app version into the shared renderer", async () => {
    const server = await startShareServer({ surface: "desktop", appVersion: "0.3.0", idleTimeoutMs: null });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('data-surface="desktop"');
      expect(page).toContain("0.3.0");
      expect(page).not.toContain('id="done"');
    } finally {
      await server.close();
    }
  });

  it("serves the resolved locale and stable localized API errors", async () => {
    const server = await startShareServer({ locale: "en" });
    try {
      expect(new URL(server.url).hostname).toBe("127.0.0.1");
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('<html lang="en">');
      expect(page).toContain("Share session turns");

      const response = await fetch(new URL("/missing", server.url));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ code: "NOT_FOUND", message: "Not found" });
    } finally {
      await server.close();
    }
  });

  it("persists explicit language, switches live responses, then follows the injected system locale", async () => {
    const home = await tempHome();
    let detectorCalls = 0;
    const server = await startShareServer({
      locale: "en",
      languagePreference: "en",
      configHome: home,
      systemLocaleDetector: async () => {
        detectorCalls += 1;
        return { locale: "en-US", source: "test system" };
      },
    });
    try {
      const explicit = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "zh-CN" }),
      });
      expect(explicit.status).toBe(200);
      await expect(explicit.json()).resolves.toMatchObject({
        ok: true,
        language: "zh-CN",
        locale: "zh-CN",
      });
      expect(await readFile(path.join(home, ".airgap", "config.json"), "utf8")).toContain(
        '"language": "zh-CN"',
      );
      const chinesePage = await fetch(server.url).then((response) => response.text());
      expect(chinesePage).toContain('<html lang="zh-CN">');
      expect(chinesePage).toContain('<option value="zh-CN" selected>简体中文</option>');
      await expect(fetch(new URL("/missing", server.url)).then((response) => response.json())).resolves.toEqual({
        code: "NOT_FOUND",
        message: "未找到",
      });

      const automatic = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "auto" }),
      });
      await expect(automatic.json()).resolves.toMatchObject({
        ok: true,
        language: "auto",
        locale: "en",
      });
      expect(detectorCalls).toBe(1);
      const persisted = JSON.parse(
        await readFile(path.join(home, ".airgap", "config.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(persisted).not.toHaveProperty("language");
      const englishPage = await fetch(server.url).then((response) => response.text());
      expect(englishPage).toContain('<html lang="en">');
      expect(englishPage).toContain('<option value="auto" selected>Follow system</option>');
    } finally {
      await server.close();
    }
  });

  it("rejects unsupported language values without changing the live locale", async () => {
    const server = await startShareServer({ locale: "en", configHome: await tempHome() });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "fr" }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_LANGUAGE" });
      expect(await fetch(server.url).then((result) => result.text())).toContain('<html lang="en">');
    } finally {
      await server.close();
    }
  });

  it("rejects a null config request body as a stable client error", async () => {
    const server = await startShareServer({ locale: "en", configHome: await tempHome() });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_CONFIG_BODY" });
    } finally {
      await server.close();
    }
  });

  it("keeps the live locale unchanged when language persistence fails", async () => {
    const home = await tempHome("{ broken");
    const server = await startShareServer({ locale: "en", languagePreference: "en", configHome: home });
    try {
      const response = await fetch(new URL("/api/config", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "zh-CN" }),
      });
      expect(response.status).toBe(500);
      expect(await readFile(path.join(home, ".airgap", "config.json"), "utf8")).toBe("{ broken");
      expect(await fetch(server.url).then((result) => result.text())).toContain('<html lang="en">');
      await expect(fetch(new URL("/missing", server.url)).then((result) => result.json())).resolves.toEqual({
        code: "NOT_FOUND",
        message: "Not found",
      });
    } finally {
      await server.close();
    }
  });
});

describe("Share server export adapter wiring", () => {
  it.each([
    null,
    {},
    { turns: [1], action: "save", format: "../../../.zshrc", redact: true },
    { sessionId: "session", turns: "1", action: "save", format: "md", redact: true },
    { sessionId: "session", turns: [1], action: "save", format: "md", redact: "yes" },
  ])("rejects an invalid export body before session lookup or adapter use: %j", async (body) => {
    const adapter: ShareExportAdapter = {
      renderPng: vi.fn(async () => Buffer.from("png")),
      copyImage: vi.fn(async () => {}),
      copyText: vi.fn(async () => {}),
      saveFile: vi.fn(async () => "/unused"),
    };
    const server = await startShareServer({ idleTimeoutMs: null, exportAdapter: adapter });
    try {
      const response = await fetch(new URL("/api/export", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_EXPORT_REQUEST" });
      expect(adapter.renderPng).not.toHaveBeenCalled();
      expect(adapter.copyImage).not.toHaveBeenCalled();
      expect(adapter.copyText).not.toHaveBeenCalled();
      expect(adapter.saveFile).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("counts an export from route entry before its request body finishes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter: ShareExportAdapter = {
      renderPng: vi.fn(async () => Buffer.from("png")),
      saveFile: vi.fn(async () => "/unused"),
    };
    const server = await startShareServer({ idleTimeoutMs: null, exportAdapter: adapter });
    const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(server.url).port) });
    try {
      await once(socket, "connect");
      socket.write(
        "POST /api/export HTTP/1.1\r\n" +
        `Host: ${new URL(server.url).host}\r\n` +
        "Content-Type: application/json\r\n" +
        "Content-Length: 100\r\n" +
        "Connection: close\r\n\r\n{",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      let idle = false;
      const waiting = server.whenExportsIdle().then(() => { idle = true; });
      await Promise.resolve();
      expect(idle).toBe(false);

      socket.destroy();
      await waiting;
      expect(idle).toBe(true);
      expect(adapter.renderPng).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(error).not.toHaveBeenCalled();
    } finally {
      socket.destroy();
      await server.close();
      await new Promise<void>((resolve) => setImmediate(resolve));
      error.mockRestore();
    }
  });

  it("exposes export idleness and returns a neutral HTTP 200 cancellation", async () => {
    const { home, sessionId } = await tempHomeWithClaudeSession();
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    let finishSave!: (value: string | null) => void;
    const saveFile = vi.fn(() => new Promise<string | null>((resolve) => { finishSave = resolve; }));
    const adapter: ShareExportAdapter = {
      renderPng: vi.fn(async () => Buffer.from("png")),
      copyImage: vi.fn(async () => {}),
      copyText: vi.fn(async () => {}),
      saveFile,
    };
    const server = await startShareServer({ idleTimeoutMs: null, configHome: home, exportAdapter: adapter });
    try {
      const exporting = fetch(new URL("/api/export", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, turns: [1], format: "png", action: "save", redact: true, tools: "summary" }),
      });
      await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
      let idle = false;
      const waiting = server.whenExportsIdle().then(() => { idle = true; });
      await Promise.resolve();
      expect(idle).toBe(false);

      finishSave(null);
      const response = await exporting;
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        cancelled: true,
        code: "EXPORT_CANCELLED",
      });
      await waiting;
      expect(idle).toBe(true);
    } finally {
      await server.close();
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
    }
  });

  it("maps capture failures to HTTP 500 without invoking save", async () => {
    const { home, sessionId } = await tempHomeWithClaudeSession();
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter: ShareExportAdapter = {
      renderPng: vi.fn(async () => { throw new Error("capture failed"); }),
      saveFile: vi.fn(async () => "/unused"),
    };
    const server = await startShareServer({ idleTimeoutMs: null, configHome: home, exportAdapter: adapter });
    try {
      const response = await fetch(new URL("/api/export", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, turns: [1], format: "png", action: "save", redact: true, tools: "summary" }),
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: "EXPORT_CAPTURE_FAILED" });
      expect(adapter.saveFile).not.toHaveBeenCalled();
    } finally {
      await server.close();
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      error.mockRestore();
    }
  });
});

describe("Share server desktop loopback access", () => {
  it.each(["", "short", "a".repeat(42), "a".repeat(44), "_".repeat(43)])(
    "rejects an invalid configured capability before listening: %s",
    async (accessToken) => {
      await expect(startShareServer({ accessToken, idleTimeoutMs: null })).rejects.toThrow(/accessToken/);
    },
  );

  it("keeps the CLI surface unauthenticated when no capability is configured", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    try {
      expect((await fetch(server.url)).status).toBe(200);
      expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("bootstraps an isolated HttpOnly cookie without leaking the token into url or HTML", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      expect(server.url).toBe(`http://127.0.0.1:${port}/`);
      expect(server.url).not.toContain(accessToken);
      expect(server.entryUrl).toBe(`${server.url}?access=${accessToken}`);

      const { response, cookie } = await bootstrapCookie(server.entryUrl);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBe(
        `${shareCookieName(port)}=${accessToken}; HttpOnly; SameSite=Strict; Path=/`,
      );

      const pageResponse = await fetch(server.url, { headers: { cookie } });
      expect(pageResponse.status).toBe(200);
      const html = await pageResponse.text();
      expect(html).not.toContain(accessToken);

      const nonCookieResponseData = [
        String(response.status),
        response.headers.get("location") ?? "",
        response.headers.get("cache-control") ?? "",
        response.headers.get("referrer-policy") ?? "",
        await response.text(),
        html,
      ].join("\n");
      expect(nonCookieResponseData).not.toContain(accessToken);
    } finally {
      await server.close();
    }
  });

  it("allows the process-local bootstrap capability to be replayed until shutdown", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);
    } finally {
      await server.close();
    }
  });

  it("marks every authenticated HTML, API, not-found, and error response no-store", async () => {
    const accessToken = createShareAccessToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const home = await tempHome();
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    const server = await startShareServer({
      accessToken,
      idleTimeoutMs: null,
      configHome: home,
    });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const origin = server.url.slice(0, -1);
      const requests = [
        await fetch(server.url, { headers: { cookie } }),
        await fetch(new URL("/api/sessions", server.url), { headers: { cookie } }),
        await fetch(new URL("/api/session/definitely-not-a-real-session", server.url), {
          headers: { cookie },
        }),
        await fetch(new URL("/missing", server.url), { headers: { cookie } }),
        await fetch(new URL("/api/config", server.url), {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ sessionListLimit: 10 }),
        }),
        await fetch(new URL("/api/export", server.url), {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: "{",
        }),
      ];

      expect(requests.map((response) => response.status)).toEqual([200, 200, 404, 404, 200, 500]);
      for (const response of requests) {
        expect(response.headers.get("cache-control"), String(response.status)).toBe("no-store");
      }
    } finally {
      await server.close();
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      error.mockRestore();
    }
  });

  it("rejects absolute, network-path, backslash, and fragmented request targets before bootstrap", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const targets = [
        `//evil.example/?access=${accessToken}`,
        `//127.0.0.1:${port}/?access=${accessToken}`,
        `/\\evil.example/?access=${accessToken}`,
        `http://127.0.0.1:${port}/?access=${accessToken}`,
        `/?access=${accessToken}#fragment`,
      ];

      for (const target of targets) {
        const response = await responseHeadForRawRequest(
          port,
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
        );
        expect(response, target).toMatch(/^HTTP\/1\.1 400 /);
        expect(response, target).not.toMatch(/^set-cookie:/im);
      }
    } finally {
      await server.close();
    }
  });

  it("refreshes the finite idle timeout after a successful bootstrap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      expect((await fetch(server.entryUrl, { redirect: "manual" })).status).toBe(303);

      await vi.advanceTimersByTimeAsync(40);
      expect(server.isClosed()).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("fails closed for every route before cookie authentication", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      for (const pathname of ["/", "/favicon.ico", "/missing", "/api/sessions"]) {
        const response = await fetch(new URL(pathname, server.url));
        expect(response.status, pathname).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
      }
    } finally {
      await server.close();
    }
  });

  it("rejects malformed bootstrap queries even when a valid cookie is present", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const malformed = [
        `/?access=${accessToken}&access=${accessToken}`,
        `/?access=${accessToken}&extra=1`,
        "/?other=1",
        `/?access=${createShareAccessToken()}`,
        `/api/sessions?access=${accessToken}`,
      ];
      for (const target of malformed) {
        const response = await fetch(new URL(target, server.url), { headers: { cookie } });
        expect(response.status, target).toBe(401);
      }

      expect((await fetch(server.url, { headers: { cookie } })).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects duplicate or URL-encoded capability cookies", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const name = shareCookieName(Number(new URL(server.url).port));
      const duplicate = `${name}=${accessToken}; ${name}=${accessToken}`;
      expect((await fetch(server.url, { headers: { cookie: duplicate } })).status).toBe(401);

      const encoded = `${name}=${accessToken.replace(/[A-Za-z]/, (character) =>
        `%${character.charCodeAt(0).toString(16)}`,
      )}`;
      expect((await fetch(server.url, { headers: { cookie: encoded } })).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("requires the exact loopback Host before bootstrap or cookie checks", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const response = await responseHeadForRawRequest(
        port,
        `GET /?access=${accessToken} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toMatch(/^HTTP\/1\.1 400 /);
      expect(response).not.toContain(accessToken);
    } finally {
      await server.close();
    }
  });

  it("checks cookie before POST Origin and accepts only the exact loopback Origin", async () => {
    const accessToken = createShareAccessToken();
    const server = await startShareServer({
      accessToken,
      idleTimeoutMs: null,
      configHome: await tempHome(),
    });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const endpoint = new URL("/api/config", server.url);
      const body = JSON.stringify({ sessionListLimit: 10 });

      const noCookieWrongOrigin = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body,
      });
      expect(noCookieWrongOrigin.status).toBe(401);

      for (const origin of [undefined, "https://evil.example", server.url, "http://localhost:1"]) {
        const headers: Record<string, string> = { cookie, "content-type": "application/json" };
        if (origin !== undefined) headers.origin = origin;
        const response = await fetch(endpoint, { method: "POST", headers, body: "{" });
        expect(response.status, String(origin)).toBe(403);
      }

      const expectedOrigin = server.url.slice(0, -1);
      const allowed = await fetch(endpoint, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: expectedOrigin },
        body,
      });
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns 401 without reading a declared huge POST body", async () => {
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: null });
    try {
      const port = Number(new URL(server.url).port);
      const response = await responseHeadForRawRequest(
        port,
        "POST /api/export HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          `Origin: http://127.0.0.1:${port}\r\n` +
          "Content-Type: application/json\r\n" +
          "Content-Length: 999999999\r\n" +
          "Connection: close\r\n\r\n",
      );
      expect(response).toMatch(/^HTTP\/1\.1 401 /);
    } finally {
      await server.close();
    }
  });

  it("does not refresh idle time for an unauthenticated request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ accessToken: createShareAccessToken(), idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      expect((await fetch(server.url)).status).toBe(401);
      await vi.advanceTimersByTimeAsync(40);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("does not write the configured capability into server errors", async () => {
    const accessToken = createShareAccessToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await startShareServer({ accessToken, idleTimeoutMs: null });
    try {
      const { cookie } = await bootstrapCookie(server.entryUrl);
      const response = await fetch(new URL("/api/export", server.url), {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: server.url.slice(0, -1),
        },
        body: "{",
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(accessToken);
      expect(error.mock.calls.flat().join("\n")).not.toContain(accessToken);
    } finally {
      await server.close();
      error.mockRestore();
    }
  });
});

describe("Share server lifecycle", () => {
  it("closes after the configured idle timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(19);
    expect(server.isClosed()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(server.closed).resolves.toBeUndefined();
    expect(server.isClosed()).toBe(true);
  });

  it("stays open when the caller disables idle shutdown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: null });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(server.isClosed()).toBe(false);
    await server.close();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "rejects invalid idle timeout %s",
    async (idleTimeoutMs) => {
      await expect(startShareServer({ idleTimeoutMs })).rejects.toThrow(/idleTimeoutMs/);
    },
  );

  it("resets the configured idle timeout after a request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({ idleTimeoutMs: 100 });
    try {
      await vi.advanceTimersByTimeAsync(60);
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      await response.text();

      await vi.advanceTimersByTimeAsync(60);
      expect(server.isClosed()).toBe(false);
      await vi.advanceTimersByTimeAsync(40);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("marks closing immediately and returns one close promise", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const firstClose = server.close();

    expect(server.isClosed()).toBe(true);
    expect(server.close()).toBe(firstClose);
    await firstClose;
  });

  it("allows concurrent close calls and releases the listener before resolving", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const port = Number(new URL(server.url).port);

    await Promise.all([server.close(), server.close()]);
    await expect(server.closed).resolves.toBeUndefined();

    const rebound = await startShareServer({ port, idleTimeoutMs: null });
    try {
      expect(Number(new URL(rebound.url).port)).toBe(port);
    } finally {
      await rebound.close();
    }
  });

  it("keeps entryUrl equal to url before access control is enabled", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    try {
      expect(server.entryUrl).toBe(server.url);
    } finally {
      await server.close();
    }
  });

  it("flushes the close response before shutting down", async () => {
    const server = await startShareServer({ idleTimeoutMs: null });
    const response = await fetch(new URL("/api/close", server.url), { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(server.closed).resolves.toBeUndefined();
  });

  it("force-closes a hanging request after the bounded drain period", async () => {
    const home = await tempHome();
    let markRequestEntered!: () => void;
    const requestEntered = new Promise<void>((resolve) => {
      markRequestEntered = resolve;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await startShareServer({
      idleTimeoutMs: null,
      configHome: home,
      systemLocaleDetector: async () => {
        markRequestEntered();
        return new Promise<never>(() => {});
      },
    });
    const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(server.url).port) });
    socket.on("error", () => {});
    try {
      await once(socket, "connect");
      const body = JSON.stringify({ language: "auto" });
      socket.write(
        "POST /api/config HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
          body,
      );
      await requestEntered;

      const closing = server.close();
      expect(server.isClosed()).toBe(true);
      let settled = false;
      void server.closed.then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      await closing;
      expect(socket.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await server.close();
    }
  });
});

describe("renderPage 平台适配：复制到剪贴板只有 macOS 支持", () => {
  it("mac 上「复制长图」是主按钮，且不带 mac-only 提示", () => {
    const page = renderPage(undefined, "summary", true);
    expect(page).toMatch(/<button class="primary" data-a="clipboard" data-f="png"[^>]*>复制长图<\/button>/);
    expect(page).toContain('<button data-a="download" data-f="png">下载 PNG</button>');
    expect(page).toContain("点「复制长图」→ Cmd-V 粘贴");
  });

  it("非 mac 上「下载 PNG」变主按钮，剪贴板按钮降级并带 mac-only 提示，引导文案不再提 Cmd-V", () => {
    const page = renderPage(undefined, "summary", false);
    expect(page).toContain('<button class="primary" data-a="download" data-f="png">下载 PNG</button>');
    expect(page).toMatch(/<button data-a="clipboard" data-f="png" title="[^"]*macOS[^"]*"[^>]*>复制长图<\/button>/);
    expect(page).toMatch(/<button data-a="clipboard" data-f="md" title="[^"]*macOS[^"]*"[^>]*>复制 Markdown<\/button>/);
    expect(page).not.toContain("Cmd-V");
    expect(page).toContain("点「下载 PNG」保存图片");
  });
});
