import { describe, expect, it } from "vitest";
import type { RuleMatch, Turn } from "../src/types.js";
import { exportBlockReason, startShareServer } from "../src/server/share-server.js";
import { renderPage, serializeForScript } from "../src/server/page.js";

const scan = (s: string): RuleMatch[] =>
  s.includes("sk-ant-LEAK")
    ? [{ ruleId: "anthropic-key", severity: "critical", secret: "sk-ant-LEAK", preview: "sk-a…LEAK" }]
    : [];

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
    expect(page).toContain('$("language").value = LANGUAGE_PREFERENCE');
  });

  it("selects the current explicit Chinese preference", () => {
    const page = renderPage(undefined, "summary", true, "zh-CN", "zh-CN");
    expect(page).toContain('<option value="zh-CN" selected>简体中文</option>');
    expect(page).toContain('<option value="auto">跟随系统</option>');
    expect(page).toContain('<option value="en">英文</option>');
  });
});

describe("Share server locale wiring", () => {
  it("serves the resolved locale and stable localized API errors", async () => {
    const server = await startShareServer({ locale: "en" });
    try {
      const page = await fetch(server.url).then((response) => response.text());
      expect(page).toContain('<html lang="en">');
      expect(page).toContain("Share session turns");

      const response = await fetch(new URL("/missing", server.url));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ code: "NOT_FOUND", message: "Not found" });
    } finally {
      server.close();
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
