import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderPage } from "../src/server/page.js";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("share picker manual refresh", () => {
  it("renders an accessible refresh button beside the session selector", () => {
    const page = renderPage();
    const session = page.indexOf('id="sess"');
    const refresh = page.indexOf('id="refresh"');

    expect(session).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(session);
    expect(page).toContain('title="刷新会话数据"');
    expect(page).toContain('aria-label="刷新会话数据"');
  });

  it("serializes refreshes and keeps the active selection while loading current data", async () => {
    const source = await readFile(path.join(root, "src/server/page.ts"), "utf8");

    expect(source).toContain("let manualRefreshInFlight = false");
    expect(source).toContain("if (manualRefreshInFlight || interactionBusy()) return;");
    expect(source).toContain("await refreshSessions()");
    expect(source).toContain('await loadSession(detail.id, true, msg(SURFACE === "desktop"');
    expect(source).toContain('"share.desktop.conversationRefreshed" : "share.page.sessionRefreshed"');
    expect(source).toContain('endInteraction("refresh")');
    expect(source).not.toContain("button.disabled = false");
    expect(source).toContain('button.removeAttribute("aria-busy")');
    expect(source).toContain('"share.desktop.refreshFailed" : "share.page.refreshFailed"');
    expect(source).not.toMatch(/setInterval|WebSocket/);
  });
});
