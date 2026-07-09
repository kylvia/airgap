import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import pc from "picocolors";
import { scanSessionFile } from "../detect/scanner.js";
import { discoverSessions } from "../discovery.js";
import { renderScanReport, type ScanReportData } from "../render/scan-report.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import type { Finding, SessionInfo, SessionSource, Severity } from "../types.js";

interface ScanCliOptions {
  json?: boolean;
  source?: string;
  project?: string;
  list?: boolean;
  html?: boolean;
  png?: boolean;
  out?: string;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium"];

const SEV_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.red(s),
  high: (s) => pc.yellow(s),
  medium: (s) => pc.blue(s),
};

const DAY_MS = 86_400_000;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** Pad plain-text rows to per-column widths, then colorize (ANSI-safe alignment). */
function renderTable(
  headers: string[],
  rows: string[][],
  colorize: (cell: string, row: number, col: number) => string,
): string[] {
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? "").length)));
  const line = (cells: string[], row: number): string =>
    cells
      .map((cell, c) => {
        const padded = cell.padEnd(widths[c]!);
        return row < 0 ? pc.bold(pc.dim(padded)) : colorize(padded, row, c);
      })
      .join("  ")
      .trimEnd();
  return [line(headers, -1), ...rows.map((r, i) => line(r, i))];
}

interface ProjectGroup {
  project: string;
  totalSessions: number;
  hitSessions: number;
  bySeverity: Record<Severity, number>;
  oldestHitMtimeMs: number;
}

function groupByProject(results: Array<{ info: SessionInfo; findings: Finding[] }>): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const { info, findings } of results) {
    let g = groups.get(info.project);
    if (!g) {
      g = {
        project: info.project,
        totalSessions: 0,
        hitSessions: 0,
        bySeverity: { critical: 0, high: 0, medium: 0 },
        oldestHitMtimeMs: Number.POSITIVE_INFINITY,
      };
      groups.set(info.project, g);
    }
    g.totalSessions += 1;
    if (findings.length > 0) {
      g.hitSessions += 1;
      g.oldestHitMtimeMs = Math.min(g.oldestHitMtimeMs, info.mtimeMs);
      for (const f of findings) g.bySeverity[f.severity] += 1;
    }
  }
  return [...groups.values()]
    .filter((g) => g.hitSessions > 0)
    .sort(
      (a, b) =>
        b.bySeverity.critical - a.bySeverity.critical ||
        b.bySeverity.high - a.bySeverity.high ||
        b.bySeverity.medium - a.bySeverity.medium ||
        a.project.localeCompare(b.project),
    );
}

function printTable(groups: ProjectGroup[]): void {
  const now = Date.now();
  const headers = ["PROJECT", "SESSIONS", "CRITICAL", "HIGH", "MEDIUM", "OLDEST"];
  const rows = groups.map((g) => [
    shortPath(g.project),
    `${g.hitSessions}/${g.totalSessions}`,
    String(g.bySeverity.critical),
    String(g.bySeverity.high),
    String(g.bySeverity.medium),
    `${Math.max(0, Math.floor((now - g.oldestHitMtimeMs) / DAY_MS))}d`,
  ]);
  const lines = renderTable(headers, rows, (cell, _row, col) => {
    if (col === 0) return pc.cyan(cell);
    if (col >= 2 && col <= 4) {
      if (cell.trim() === "0") return pc.dim(cell);
      const sev = SEVERITIES[col - 2]!;
      return SEV_COLOR[sev](pc.bold(cell));
    }
    if (col === 5) return pc.dim(cell);
    return cell;
  });
  for (const l of lines) console.log(l);
}

function printList(findings: Finding[]): void {
  const sorted = [...findings].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.project.localeCompare(b.project) ||
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.lineNo - b.lineNo,
  );
  for (const f of sorted) {
    const parts = [
      SEV_COLOR[f.severity](f.severity.padEnd(8)),
      f.ruleId.padEnd(20),
      f.preview.padEnd(24),
      `×${f.count}`.padEnd(4),
      pc.dim(`${f.source}:${f.sessionId.slice(0, 8)}`.padEnd(15)),
      `${shortPath(f.sourceFile)}:${f.lineNo}`,
    ];
    if (f.fieldPath) parts.push(pc.dim(f.fieldPath));
    console.log(parts.join("  "));
  }
}

/** Build the shareable report-card data from grouped results. */
function buildReportData(
  results: Array<{ info: SessionInfo; findings: Finding[] }>,
  allFindings: Finding[],
  scannedSessions: number,
  hitSessions: number,
  elapsedSeconds: number,
  sources: SessionSource[] | undefined,
): ScanReportData {
  const SHOWN = 8;
  const now = Date.now();
  const groups = groupByProject(results);
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  for (const f of allFindings) bySeverity[f.severity] += 1;
  const sourceLabel = sources ? (sources[0] === "claude" ? "~/.claude" : "~/.codex") : "~/.claude + ~/.codex";
  return {
    scannedSessions,
    hitSessions,
    elapsedSeconds,
    bySeverity,
    groups: groups.slice(0, SHOWN).map((g) => ({
      project: g.project,
      hitSessions: g.hitSessions,
      totalSessions: g.totalSessions,
      critical: g.bySeverity.critical,
      high: g.bySeverity.high,
      medium: g.bySeverity.medium,
      oldestDays: Math.max(0, Math.floor((now - g.oldestHitMtimeMs) / DAY_MS)),
    })),
    moreGroups: Math.max(0, groups.length - SHOWN),
    sourceLabel,
    date: new Date().toISOString().slice(0, 10),
  };
}

function printSummary(hitSessions: number, totalSessions: number): void {
  console.log("");
  if (hitSessions > 0) {
    console.log(
      `${pc.yellow("⚠")} ${pc.bold(String(hitSessions))} of ${totalSessions} sessions contain plaintext secrets that would leak if shared or synced.`,
    );
  } else {
    console.log(pc.green(`✓ No plaintext secrets found in ${totalSessions} sessions.`));
  }
}

async function runScan(opts: ScanCliOptions): Promise<void> {
  // Tolerate downstream pipes closing early (e.g. `airgap scan --json | head`).
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(process.exitCode ?? 0);
  });

  if (opts.source !== undefined && opts.source !== "claude" && opts.source !== "codex") {
    console.error(`airgap scan: invalid --source "${opts.source}" (expected claude or codex)`);
    process.exitCode = 2;
    return;
  }
  const sources = opts.source !== undefined ? [opts.source as SessionSource] : undefined;

  const started = Date.now();
  const sessions = await discoverSessions({ sources, project: opts.project });
  process.stderr.write(pc.dim(`airgap scan: scanning ${sessions.length} sessions...\n`));
  const results = await mapLimit(sessions, 8, async (info) => ({
    info,
    findings: await scanSessionFile(info),
  }));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(pc.dim(`airgap scan: done in ${elapsed}s\n`));

  const allFindings = results.flatMap((r) => r.findings);
  const hitSessions = results.filter((r) => r.findings.length > 0).length;

  if (opts.png || opts.html) {
    // Shareable Dossier report card (single-file HTML, or PNG via system Chrome).
    // Counts and basename-only project labels only — never a secret preview.
    const data = buildReportData(results, allFindings, sessions.length, hitSessions, Number(elapsed), sources);
    const html = renderScanReport(data);
    const outFile = path.resolve(opts.out ?? `airgap-scan-${data.date}.${opts.png ? "png" : "html"}`);
    if (opts.png) {
      const chrome = findChrome();
      if (!chrome) {
        console.error(
          pc.red("没找到本机 Chrome/Chromium（PNG 出图需要它）。可设 CHROME_PATH 指定，或改用 --html 输出单文件网页。"),
        );
        process.exitCode = 1;
        return;
      }
      try {
        await renderPngViaChrome(html, outFile, chrome);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
        return;
      }
    } else {
      await writeFile(outFile, html, "utf8");
    }
    console.log(`${pc.green("✔")} 扫描报告卡 · ${hitSessions}/${sessions.length} 会话命中 → ${outFile}`);
    if (allFindings.length > 0) process.exitCode = 1;
    return;
  }

  if (opts.json) {
    // Machine-readable output. The raw secret text is deliberately omitted —
    // only the masked preview leaves the process.
    const payload = {
      scannedSessions: sessions.length,
      sessionsWithSecrets: hitSessions,
      elapsedSeconds: Number(elapsed),
      findings: allFindings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        preview: f.preview,
        count: f.count,
        source: f.source,
        project: f.project,
        sessionId: f.sessionId,
        sourceFile: f.sourceFile,
        lineNo: f.lineNo,
        fieldPath: f.fieldPath,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
  } else if (opts.list) {
    printList(allFindings);
    printSummary(hitSessions, sessions.length);
  } else {
    const groups = groupByProject(results);
    if (groups.length > 0) printTable(groups);
    printSummary(hitSessions, sessions.length);
  }

  if (allFindings.length > 0) process.exitCode = 1;
}

export function registerScan(program: Command): void {
  program
    .command("scan")
    .description("Scan local AI coding sessions for plaintext secrets")
    .option("--json", "machine-readable JSON output (secrets masked)")
    .option("--source <source>", "limit to one source: claude | codex")
    .option("--project <substr>", "only sessions whose project path contains <substr>")
    .option("--list", "print every finding on its own line (masked preview)")
    .option("--html", "render a shareable scan report card (single-file HTML)")
    .option("--png", "render the scan report card as a PNG (requires a local Chrome)")
    .option("--out <file>", "output file path for --html / --png")
    .action(async (opts: ScanCliOptions) => {
      await runScan(opts);
    });
}
