import { describe, expect, it } from "vitest";
import type { RuleMatch, Turn } from "../src/types.js";
import { exportBlockReason } from "../src/server/share-server.js";
import { renderPage } from "../src/server/page.js";

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
    for (const id of ["sess", "sbanner", "list", "preview", "status", "count", "all", "none", "done", "tools", "redact", "loading"]) {
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
