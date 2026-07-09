import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDisplay, Turn } from "../types.js";
import { DEFAULT_TOOL_DISPLAY, TOOL_DISPLAYS } from "../types.js";
import { discoverSessions } from "../discovery.js";
import { scanString } from "../detect/scanner.js";
import { extractTurns } from "../render/turns.js";
import { renderMarkdown } from "../render/markdown.js";
import { renderHtml } from "../render/html.js";
import { findChrome, renderPngViaChrome } from "../render/screenshot.js";
import { oneLine, pickSession, readRecords, redactTurns, scanTurns, sessionTitle } from "../session.js";

interface ShowOpts {
  last?: string;
  turns?: string;
  pick?: boolean;
  session?: string;
  md?: boolean;
  html?: boolean;
  png?: boolean;
  out?: string;
  yes?: boolean;
  redact?: boolean;
  tools?: string;
}

// ---------- PNG：驱动系统 Chrome，零 npm 依赖 ----------

async function renderPng(html: string, outFile: string): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "没找到本机 Chrome/Chromium（PNG 出图需要它来渲染）。可设 CHROME_PATH 指定，或改用 --html 输出单文件网页。",
    );
  }
  await renderPngViaChrome(html, outFile, chromePath);
}

// ---------- show 命令 ----------

export function registerShow(program: Command): void {
  program
    .command("show")
    .description("Render selected turns of a session to markdown / single-file HTML / long-image PNG (HTML by default)")
    .option("--last <n>", "keep only the last N turns")
    .option("--turns <list>", "export specific turns by number, comma-separated (e.g. 2,4,8)")
    .option("--pick", "interactively select which turns to export")
    .option("--session <prefix>", "select a session by session id prefix")
    .option("--md", "output markdown")
    .option("--html", "output a single-file HTML (default)")
    .option("--png", "output a long-image PNG (requires a local Chrome)")
    .option("--out <file>", "output file path")
    .option("--tools <level>", `tool-call display: none | summary | full (default: ${DEFAULT_TOOL_DISPLAY})`)
    .option("--redact", "redact detected secrets (placeholders) before exporting, instead of blocking")
    .option("--yes", "skip the secret-hit confirmation")
    .action(async (opts: ShowOpts) => {
      // 0. 校验工具展示级别（渲染时生效；扫描/脱敏始终覆盖全部字段，从宽拦截）
      if (opts.tools !== undefined && !(TOOL_DISPLAYS as readonly string[]).includes(opts.tools)) {
        console.error(pc.red(`--tools 只接受 ${TOOL_DISPLAYS.join(" | ")}，收到：${opts.tools}`));
        process.exitCode = 1;
        return;
      }
      const toolDisplay: ToolDisplay = (opts.tools as ToolDisplay | undefined) ?? DEFAULT_TOOL_DISPLAY;

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
      } else if (opts.turns !== undefined) {
        const want = new Set(
          opts.turns
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isInteger(n) && n > 0),
        );
        if (want.size === 0) {
          console.error(pc.red(`--turns 需要逗号分隔的正整数轮次编号，如 --turns 2,4,8；收到：${opts.turns}`));
          process.exitCode = 1;
          return;
        }
        selected = turns.filter((t) => want.has(t.index));
        if (selected.length === 0) {
          console.error(pc.red(`没有匹配到任何轮次（会话共 ${turns.length} 轮，编号 1–${turns.length}）`));
          process.exitCode = 1;
          return;
        }
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

      // 4. 出图前处理密钥：--redact 脱敏后导出（推荐）；否则命中就拦截，--yes 才跳过确认
      let redactedCount = 0;
      if (opts.redact) {
        // 脱敏（占位符）后再导出：结果由 redactor 的 fail-closed 复扫保证干净
        const before = scanTurns(selected, scanString).length;
        if (before > 0) {
          const red = redactTurns(selected, scanString);
          selected = red.turns;
          redactedCount = red.count;
        }
      } else {
        const findings = scanTurns(selected, scanString);
        if (findings.length > 0) {
          console.error(pc.yellow(`⚠ 选中内容里发现 ${findings.length} 处疑似密钥/敏感信息：`));
          for (const f of findings) {
            console.error(`  ${pc.red(f.severity.padEnd(8))} ${f.ruleId}  ${f.preview}`);
          }
          if (!opts.yes) {
            if (!process.stdin.isTTY) {
              console.error(pc.red("非交互环境无法确认。用 --redact 脱敏后导出，或用 --yes 确认原样出图。"));
              process.exitCode = 1;
              return;
            }
            const go = await p.confirm({ message: "仍要原样出图吗？（推荐改用 --redact 脱敏后导出）", initialValue: false });
            if (p.isCancel(go) || !go) {
              p.cancel("已取消");
              process.exitCode = 1;
              return;
            }
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
        await writeFile(outFile, renderMarkdown(selected, meta, { tools: toolDisplay }), "utf8");
      } else {
        const html = renderHtml(selected, meta, { tools: toolDisplay });
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
      if (redactedCount > 0) {
        console.log(pc.dim(`  已脱敏 ${redactedCount} 处疑似密钥（占位符替换，原文未写入导出物）`));
      }
    });
}
