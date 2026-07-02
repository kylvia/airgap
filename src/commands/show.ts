import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonlRecord, RuleMatch, SessionInfo, Turn } from "../types.js";
import { streamLines, tryParse } from "../util/jsonl.js";
import { discoverSessions } from "../discovery.js";
import { scanString } from "../detect/scanner.js";
import { extractTurns } from "../render/turns.js";
import { renderMarkdown } from "../render/markdown.js";
import { renderHtml } from "../render/html.js";

interface ShowOpts {
  last?: string;
  pick?: boolean;
  session?: string;
  md?: boolean;
  html?: boolean;
  png?: boolean;
  out?: string;
  yes?: boolean;
}

// ---------- PNG（puppeteer-core 可选依赖） ----------

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

function findChrome(): string | null {
  const fromEnv = process.env["CHROME_PATH"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface MiniPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setContent(html: string, opts: { waitUntil: string }): Promise<void>;
  screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
}
interface MiniBrowser {
  newPage(): Promise<MiniPage>;
  close(): Promise<void>;
}
interface MiniPuppeteer {
  launch(opts: { executablePath: string; headless: boolean }): Promise<MiniBrowser>;
}

async function renderPng(html: string, outFile: string): Promise<void> {
  let puppeteer: MiniPuppeteer;
  try {
    // @ts-ignore — puppeteer-core 是可选依赖，未安装时给友好提示
    const mod = (await import("puppeteer-core")) as { default?: MiniPuppeteer } & MiniPuppeteer;
    puppeteer = (mod.default ?? mod) as MiniPuppeteer;
  } catch {
    throw new Error("PNG 出图需要 puppeteer-core（未安装）。可 `npm i -D puppeteer-core` 后重试，或改用 --html 输出单文件网页。");
  }
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error("没找到本机 Chrome/Chromium 可执行文件（也可设 CHROME_PATH 环境变量指定）。建议改用 --html 输出单文件网页。");
  }
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 760, height: 1080, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.screenshot({ path: outFile, fullPage: true });
  } finally {
    await browser.close();
  }
}

// ---------- show 命令 ----------

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function readRecords(file: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];
  for await (const { line, lineNo } of streamLines(file)) {
    records.push({ raw: line, lineNo, json: tryParse(line) });
  }
  return records;
}

function sessionTitle(records: JsonlRecord[], info: SessionInfo): string {
  for (let i = records.length - 1; i >= 0; i--) {
    const j = records[i]?.json;
    if (j && j["type"] === "ai-title" && typeof j["aiTitle"] === "string" && j["aiTitle"].trim()) {
      return j["aiTitle"].trim();
    }
  }
  const base = info.cwd ? path.basename(info.cwd) : info.project;
  return `${base} · 会话片段`;
}

function pickSession(sessions: SessionInfo[], opts: ShowOpts): SessionInfo | null {
  if (opts.session) {
    const prefix = opts.session;
    const hit = sessions.filter((s) => s.id.startsWith(prefix)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    return hit[0] ?? null;
  }
  const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cwd = process.cwd();
  return sorted.find((s) => s.cwd === cwd) ?? sorted[0] ?? null;
}

/** 对选中轮次的所有可见文本跑扫描，同一 (ruleId, secret) 去重 */
function scanTurns(turns: Turn[], scan: (s: string) => RuleMatch[]): RuleMatch[] {
  const seen = new Set<string>();
  const findings: RuleMatch[] = [];
  const visit = (text: string): void => {
    for (const m of scan(text)) {
      const key = `${m.ruleId} ${m.secret}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(m);
    }
  };
  for (const turn of turns) {
    visit(turn.userText);
    for (const block of turn.assistant) visit(block.text);
  }
  return findings;
}

export function registerShow(program: Command): void {
  program
    .command("show")
    .description("把会话的若干轮渲染成 markdown / 单文件 HTML / 长图 PNG（默认 HTML）")
    .option("--last <n>", "只取最后 N 轮")
    .option("--pick", "交互式勾选要导出的轮次")
    .option("--session <prefix>", "按 session id 前缀指定会话")
    .option("--md", "输出 markdown")
    .option("--html", "输出单文件 HTML（默认）")
    .option("--png", "输出长图 PNG（需要本机 Chrome）")
    .option("--out <file>", "输出文件路径")
    .option("--yes", "跳过密钥命中确认")
    .action(async (opts: ShowOpts) => {
      // 1. 选会话：--session 前缀优先，否则 cwd 对应项目里最近的，再否则全局最近的
      const sessions = await discoverSessions({});
      const info = pickSession(sessions, opts);
      if (!info) {
        console.error(pc.red(opts.session ? `没找到 id 以 ${opts.session} 开头的会话` : "没发现任何本地会话"));
        process.exitCode = 1;
        return;
      }

      // 2. 读记录 → turns
      const records = await readRecords(info.file);
      const turns = extractTurns(records, info.source);
      if (turns.length === 0) {
        console.error(pc.red(`会话 ${info.id.slice(0, 8)} 里没有可渲染的对话轮`));
        process.exitCode = 1;
        return;
      }

      // 3. 选轮次
      let selected: Turn[];
      if (opts.pick) {
        p.intro(`共 ${turns.length} 轮`);
        const picked = await p.multiselect({
          message: "勾选要导出的轮次（空格勾选，回车确认）",
          options: turns.map((t) => ({ value: t.index, label: `第${t.index}轮 ${oneLine(t.userText).slice(0, 40)}` })),
          required: true,
        });
        if (p.isCancel(picked)) {
          p.cancel("已取消");
          return;
        }
        const chosen = new Set(picked as number[]);
        selected = turns.filter((t) => chosen.has(t.index));
      } else if (opts.last !== undefined) {
        const n = Number.parseInt(opts.last, 10);
        if (!Number.isFinite(n) || n <= 0) {
          console.error(pc.red(`--last 需要正整数，收到：${opts.last}`));
          process.exitCode = 1;
          return;
        }
        selected = turns.slice(-n);
      } else {
        selected = turns;
      }

      // 4. 出图前扫描：有命中先列出，--yes 才跳过确认
      const findings = scanTurns(selected, scanString);
      if (findings.length > 0) {
        console.error(pc.yellow(`⚠ 选中内容里发现 ${findings.length} 处疑似密钥/敏感信息：`));
        for (const f of findings) {
          console.error(`  ${pc.red(f.severity.padEnd(8))} ${f.ruleId}  ${f.preview}`);
        }
        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            console.error(pc.red("非交互环境无法确认。确认要带着这些内容出图请加 --yes。"));
            process.exitCode = 1;
            return;
          }
          const go = await p.confirm({ message: "仍要继续出图吗？（建议先 airgap pack 走 redact）", initialValue: false });
          if (p.isCancel(go) || !go) {
            p.cancel("已取消");
            process.exitCode = 1;
            return;
          }
        }
      }

      // 5. 渲染 + 写出
      const format: "md" | "html" | "png" = opts.png ? "png" : opts.md ? "md" : "html";
      const lastTs = selected[selected.length - 1]?.timestamp;
      const meta = {
        title: sessionTitle(records, info),
        date: (lastTs ?? new Date(info.mtimeMs).toISOString()).slice(0, 10),
      };
      const outFile = path.resolve(opts.out ?? `airgap-show-${info.id.slice(0, 8)}.${format}`);

      if (format === "md") {
        await writeFile(outFile, renderMarkdown(selected, meta), "utf8");
      } else {
        const html = renderHtml(selected, meta);
        if (format === "html") {
          await writeFile(outFile, html, "utf8");
        } else {
          try {
            await renderPng(html, outFile);
          } catch (err) {
            console.error(pc.red(err instanceof Error ? err.message : String(err)));
            process.exitCode = 1;
            return;
          }
        }
      }
      console.log(`${pc.green("✔")} ${info.source} 会话 ${info.id.slice(0, 8)} · ${selected.length} 轮 → ${outFile}`);
    });
}
