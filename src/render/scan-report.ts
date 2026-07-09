import { basename } from "node:path";
import type { Severity } from "../types.js";
import { CHAT_CSS, airgapMark, escapeHtml } from "./html.js";

/** One project row on the report card. */
export interface ScanReportGroup {
  project: string;
  hitSessions: number;
  totalSessions: number;
  critical: number;
  high: number;
  medium: number;
  oldestDays: number;
}

export interface ScanReportData {
  scannedSessions: number;
  hitSessions: number;
  elapsedSeconds: number;
  bySeverity: Record<Severity, number>;
  groups: ScanReportGroup[];
  /** how many hit projects were dropped from the shown table */
  moreGroups: number;
  /** "~/.claude + ~/.codex" or a single store */
  sourceLabel: string;
  date: string;
}

/** Thousands separators without pulling in Intl (keeps output deterministic). */
function commas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Warning triangle mark (inline SVG, zero external assets) — mirrors share's warnMark. */
function warnMark(): string {
  return '<svg class="wmark" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 15 14.2H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.6v3.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.7" r="0.55" fill="currentColor"/></svg>';
}

/** Extra card-only styles layered on top of the shared Dossier tokens (CHAT_CSS carries THEME_CSS). */
const CARD_CSS = `${CHAT_CSS}
  body { font-family: var(--font-sans); background: var(--bg-subtle); color: var(--fg); -webkit-font-smoothing: antialiased; }
  .card { max-width: 720px; margin: 0 auto; padding: 40px 40px 28px; }
  .rhead { display: flex; align-items: center; gap: 10px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
  .rhead .mark { color: var(--fg); }
  .rhead .brand { font-family: var(--font-serif); font-weight: 600; font-size: 22px; letter-spacing: -0.02em; }
  .rhead .src { margin-left: auto; font-family: var(--font-mono); font-size: 12px; color: var(--fg-subtle); }

  .hero { padding: 30px 0 26px; border-bottom: 1px solid var(--border); }
  .hero .big { font-family: var(--font-serif); font-weight: 600; letter-spacing: -0.03em; font-size: 78px; line-height: 1; color: var(--fg); }
  .hero .big .sep { color: var(--fg-subtle); font-weight: 400; margin: 0 4px; }
  .hero .big .tot { color: var(--fg-subtle); font-size: 42px; }
  .hero .cap { margin-top: 14px; font-size: 15.5px; color: var(--fg-muted); display: flex; align-items: center; gap: 8px; line-height: 1.5; }
  .hero .cap .wmark { color: var(--danger); flex-shrink: 0; }
  .hero.clean .big { color: var(--pastel-green-fg); }
  .hero.clean .cap .wmark { color: var(--pastel-green-fg); }

  .tiles { display: flex; gap: 12px; padding: 22px 0 16px; }
  .tile { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-card); padding: 15px 16px; background: var(--bg); }
  .tile .n { font-family: var(--font-mono); font-size: 30px; font-weight: 600; line-height: 1; }
  .tile .k { margin-top: 8px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-subtle); }
  .tile.crit .n { color: var(--danger); }
  .tile.high .n { color: var(--warning); }
  .tile.med .n { color: var(--pastel-blue-fg); }

  .note { font-size: 12px; color: var(--fg-subtle); line-height: 1.6; padding-bottom: 22px; border-bottom: 1px solid var(--border); }
  .note b { color: var(--fg-muted); font-weight: 600; }

  table.rt { width: 100%; border-collapse: collapse; margin: 20px 0 4px; font-size: 13px; }
  table.rt thead th { text-align: left; font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--fg-subtle); font-weight: 600; padding: 0 10px 9px; border-bottom: 1px solid var(--border); }
  table.rt th.num, table.rt td.num { text-align: right; font-family: var(--font-mono); }
  table.rt tbody td { padding: 9px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: baseline; }
  table.rt td.proj { color: var(--fg); font-weight: 500; }
  table.rt td.crit { color: var(--danger); font-weight: 600; }
  table.rt td.high { color: var(--warning); font-weight: 600; }
  table.rt td.med { color: var(--pastel-blue-fg); }
  table.rt td.zero { color: var(--fg-subtle); }
  table.rt td.age { color: var(--fg-subtle); }
  .more { font-size: 12px; color: var(--fg-subtle); padding: 8px 10px 0; }

  .rfoot { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--fg-subtle); }
  .rfoot .mark { opacity: 0.85; }
  .rfoot .cmd { margin-left: auto; font-family: var(--font-mono); color: var(--fg-muted); }
`;

/**
 * A single-file Dossier "receipt" card summarizing a scan — the shareable artifact.
 * Shows only counts and (basename-only) project labels; never a secret preview.
 * Splits confidence honestly: Critical/High key off real prefixes, Medium is heuristic.
 */
export function renderScanReport(data: ScanReportData): string {
  const { critical, high, medium } = data.bySeverity;
  const confirmed = critical + high;
  const clean = data.hitSessions === 0;

  const hero = clean
    ? `  <div class="hero clean">
    <div class="big">0</div>
    <div class="cap">${warnMark()}<span>没有会话命中明文密钥。扫了 ${commas(data.scannedSessions)} 个会话。</span></div>
  </div>`
    : `  <div class="hero">
    <div class="big">${commas(data.hitSessions)}<span class="sep">/</span><span class="tot">${commas(data.scannedSessions)}</span></div>
    <div class="cap">${warnMark()}<span>个会话藏着明文密钥，分享或同步时会一起泄露。</span></div>
  </div>`;

  const tiles = `  <div class="tiles">
    <div class="tile crit"><div class="n">${commas(critical)}</div><div class="k">Critical</div></div>
    <div class="tile high"><div class="n">${commas(high)}</div><div class="k">High</div></div>
    <div class="tile med"><div class="n">${commas(medium)}</div><div class="k">Medium</div></div>
  </div>`;

  const note = `  <div class="note"><b>${commas(confirmed)}</b> 条高置信（Critical + High，命中 <code>sk-ant-</code> / <code>ghp_</code> / <code>AKIA</code> 等真实密钥前缀），<b>${commas(medium)}</b> 条疑似（Medium，启发式匹配，含误报）。数字为去重后的 finding 数。</div>`;

  const rows = data.groups
    .map((g) => {
      const cell = (n: number, cls: string): string =>
        `<td class="num ${n > 0 ? cls : "zero"}">${n > 0 ? commas(n) : "0"}</td>`;
      return `      <tr>
        <td class="proj">${escapeHtml(basename(g.project))}</td>
        <td class="num">${g.hitSessions}/${g.totalSessions}</td>
        ${cell(g.critical, "crit")}
        ${cell(g.high, "high")}
        ${cell(g.medium, "med")}
        <td class="num age">${g.oldestDays}d</td>
      </tr>`;
    })
    .join("\n");

  const table = clean
    ? ""
    : `  <table class="rt">
    <thead><tr>
      <th>项目</th><th class="num">命中/总</th><th class="num">Crit</th><th class="num">High</th><th class="num">Med</th><th class="num">最老</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>${data.moreGroups > 0 ? `\n  <div class="more">…及其它 ${data.moreGroups} 个含密钥的项目</div>` : ""}`;

  const body = [
    `  <div class="rhead">${airgapMark(22)}<span class="brand">airgap · 密钥扫描</span><span class="src">${escapeHtml(data.sourceLabel)}</span></div>`,
    hero,
    tiles,
    note,
    table,
    `  <div class="rfoot">${airgapMark(13)}<span>${escapeHtml(data.date)} · 扫描 ${commas(data.scannedSessions)} 个会话 · ${data.elapsedSeconds}s · 全部本地完成，无上传</span><span class="cmd">npx airgap scan</span></div>`,
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>airgap · 密钥扫描报告</title>
<style>${CARD_CSS}</style>
</head>
<body>
<div class="card">
${body}
</div>
</body>
</html>
`;
}
