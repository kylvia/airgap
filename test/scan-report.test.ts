import { describe, expect, it } from "vitest";
import { renderScanReport, type ScanReportData } from "../src/render/scan-report.js";

const base: ScanReportData = {
  scannedSessions: 1216,
  hitSessions: 680,
  elapsedSeconds: 48.2,
  bySeverity: { critical: 324, high: 1420, medium: 10421 },
  groups: [
    { project: "/Users/me/work/payments-api", hitSessions: 34, totalSessions: 51, critical: 12, high: 88, medium: 140, oldestDays: 213 },
    { project: "/Users/me/side/scraper", hitSessions: 8, totalSessions: 40, critical: 3, high: 12, medium: 26, oldestDays: 95 },
  ],
  moreGroups: 22,
  sourceLabel: "~/.claude + ~/.codex",
  date: "2026-07-09",
};

describe("renderScanReport", () => {
  it("shows the hero ratio, severity tiles, and the honest confidence split", () => {
    const html = renderScanReport(base);
    expect(html).toContain("680"); // hit sessions
    expect(html).toContain("1,216"); // total, comma-grouped
    expect(html).toContain("10,421"); // medium tile, comma-grouped
    expect(html).toContain("1,744"); // confirmed = critical + high, called out honestly
    expect(html).toMatch(/高置信/);
    expect(html).toMatch(/疑似/);
  });

  it("labels projects by basename only — never leaks the full path", () => {
    const html = renderScanReport(base);
    expect(html).toContain("payments-api");
    expect(html).not.toContain("/Users/me/work");
  });

  it("summarizes dropped projects and carries the local-only footer", () => {
    const html = renderScanReport(base);
    expect(html).toMatch(/及其它 22 个/);
    expect(html).toContain("无上传");
    expect(html).toContain("npx airgap scan");
  });

  it("carries no emoji (Dossier uses inline SVG marks)", () => {
    const html = renderScanReport(base);
    // no emoji presentation characters (warn/lock/check etc.)
    expect(html).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2705}\u{26A0}]/u);
  });

  it("renders a clean state with no table when nothing hit", () => {
    const clean = renderScanReport({ ...base, hitSessions: 0, bySeverity: { critical: 0, high: 0, medium: 0 }, groups: [], moreGroups: 0 });
    expect(clean).toMatch(/没有会话命中明文密钥/);
    expect(clean).not.toContain("<table");
  });

  it("escapes project labels", () => {
    const html = renderScanReport({
      ...base,
      groups: [{ project: "/x/<script>evil", hitSessions: 1, totalSessions: 1, critical: 0, high: 0, medium: 1, oldestDays: 1 }],
    });
    expect(html).not.toContain("<script>evil");
    expect(html).toContain("&lt;script&gt;evil");
  });
});
