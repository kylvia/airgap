import * as clack from "@clack/prompts";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import type { Command } from "commander";
import { writePack } from "../ccpack.js";
import { scanString } from "../detect/scanner.js";
import { discoverSessions } from "../discovery.js";
import { redactRecords } from "../redact.js";
import { sliceSession } from "../slice.js";
import { METADATA_KEYS, walkStrings } from "../util/text.js";
import type {
  DiscoverOptions,
  JsonlRecord,
  RedactResult,
  RuleMatch,
  SessionInfo,
  SlicedSession,
} from "../types.js";

type Scanner = (s: string) => RuleMatch[];
type Discover = (opts: DiscoverOptions) => Promise<SessionInfo[]>;

export interface PackCliOptions {
  last?: boolean;
  session?: string;
  tail?: number;
  out?: string;
  yes?: boolean;
  /** commander --no-redact => redact:false */
  redact?: boolean;
  acceptRisk?: boolean;
  stripThinking?: boolean;
}

/** Injection seam for tests and for integration wiring; all optional. */
export interface PackDeps {
  discover?: Discover;
  scan?: Scanner;
  home?: string;
  cwd?: string;
  /** set false to hard-disable prompts (defaults to TTY detection) */
  interactive?: boolean;
  log?: (line: string) => void;
}

interface PackFinding extends RuleMatch {
  fieldPath: string;
  lineNo: number;
}

/** Collect unique (ruleId, secret) findings with field location, for the confirm UI. */
function collectFindings(records: JsonlRecord[], scan: Scanner): PackFinding[] {
  const seen = new Map<string, PackFinding>();
  for (const rec of records) {
    if (!rec.json) continue;
    walkStrings(rec.json, METADATA_KEYS, (value, fieldPath) => {
      for (const m of scan(value)) {
        const key = `${m.ruleId}\u0000${m.secret}`;
        if (!seen.has(key)) {
          seen.set(key, { ...m, fieldPath: fieldPath.join("."), lineNo: rec.lineNo });
        }
      }
      return undefined;
    });
  }
  return [...seen.values()];
}

function toolVersionOf(sliced: SlicedSession): string | null {
  for (const r of sliced.records) {
    const j = r.json;
    if (!j) continue;
    if (sliced.info.source === "claude" && typeof j.version === "string") return j.version;
    if (sliced.info.source === "codex" && j.type === "session_meta") {
      const p = j.payload;
      if (p && typeof p === "object" && typeof (p as Record<string, unknown>).cli_version === "string") {
        return (p as Record<string, unknown>).cli_version as string;
      }
    }
  }
  return null;
}

function defaultOutName(info: SessionInfo, now = new Date()): string {
  const dir = info.cwd ?? info.project;
  const slug = (path.basename(dir) || "session").replace(/[^A-Za-z0-9_-]+/g, "-") || "session";
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${slug}-${yy}${mm}${dd}.ccpack`;
}

async function pickSession(opts: PackCliOptions, deps: PackDeps): Promise<SessionInfo> {
  const discover = deps.discover ?? discoverSessions;
  const sessions = await discover(deps.home !== undefined ? { home: deps.home } : {});
  if (opts.session) {
    const hits = sessions.filter((s) => s.id.startsWith(opts.session as string));
    if (hits.length === 0) throw new Error(`找不到 sessionId 前缀为 "${opts.session}" 的会话`);
    if (hits.length > 1) {
      throw new Error(`前缀 "${opts.session}" 命中 ${hits.length} 个会话，请加长前缀：\n` + hits.map((h) => `  ${h.id}`).join("\n"));
    }
    return hits[0] as SessionInfo;
  }
  // --last（也是默认行为）：当前目录项目里 mtime 最新的会话
  const cwd = deps.cwd ?? process.cwd();
  const candidates = sessions.filter((s) => s.cwd === cwd || s.project === cwd);
  if (candidates.length === 0) {
    throw new Error(`当前目录（${cwd}）没有发现会话；可用 --session <prefix> 指定，或先跑 airgap scan --list 看看有什么`);
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] as SessionInfo;
}

/** Core pack flow, fully injectable; registerPack wires it to the CLI. */
export async function runPack(opts: PackCliOptions, deps: PackDeps = {}): Promise<string> {
  const log = deps.log ?? console.log;
  const interactive = deps.interactive ?? (process.stdout.isTTY === true && opts.yes !== true);

  const info = await pickSession(opts, deps);
  const sliceOpts: { tail?: number; stripThinking?: boolean } = {};
  if (opts.tail !== undefined) sliceOpts.tail = opts.tail;
  if (opts.stripThinking !== undefined) sliceOpts.stripThinking = opts.stripThinking;
  const sliced = await sliceSession(info, sliceOpts);

  if (!sliced.report.closureComplete) {
    log(pc.yellow("警告：切片存在未配对的 tool_use/tool_result（会话可能中断过），resume 后个别工具结果会缺失。"));
  }

  let redactResult: RedactResult;
  if (opts.redact === false) {
    if (opts.acceptRisk !== true) {
      throw new Error("--no-redact 必须搭配 --accept-risk：不脱敏的包可能带走密钥，风险自负");
    }
    log(pc.yellow("已跳过脱敏（--no-redact --accept-risk）。"));
    redactResult = { records: sliced.records, annotations: [], reverseMap: {} };
  } else {
    const scanner = deps.scan ?? scanString;
    const findings = collectFindings(sliced.records, scanner);
    const keep = new Set<string>();

    if (findings.length > 0 && interactive && opts.yes !== true) {
      clack.intro(pc.bold("airgap pack — 安检确认"));
      for (const f of findings) {
        const choice = await clack.select({
          message: `${pc.red(f.ruleId)} [${f.severity}] ${f.preview}  字段: ${f.fieldPath}（第 ${f.lineNo} 行）`,
          options: [
            { value: "r", label: "redact — 替换为占位符（推荐）" },
            { value: "k", label: "keep — 原样保留" },
          ],
        });
        if (clack.isCancel(choice)) {
          clack.cancel("已取消，未写包。");
          throw new Error("用户取消");
        }
        if (choice === "k") keep.add(`${f.ruleId}\u0000${f.secret}`);
      }
      const go = await clack.confirm({ message: `确认写包？（redact ${findings.length - keep.size} 项 / keep ${keep.size} 项）` });
      if (clack.isCancel(go) || go !== true) {
        clack.cancel("已取消，未写包。");
        throw new Error("用户取消");
      }
      clack.outro("开始写包");
    } else if (findings.length > 0) {
      log(`发现 ${findings.length} 处敏感信息，全部脱敏（--yes）。`);
    }

    const effectiveScan: Scanner = (s) => scanner(s).filter((m) => !keep.has(`${m.ruleId}\u0000${m.secret}`));
    redactResult = redactRecords(sliced.records, effectiveScan);
  }

  const outFile = path.resolve(deps.cwd ?? process.cwd(), opts.out ?? defaultOutName(info));
  const manifest = await writePack(outFile, sliced, redactResult, { toolVersion: toolVersionOf(sliced) });

  // reverse map（secret -> placeholder）只落本地，绝不进包
  if (Object.keys(redactResult.reverseMap).length > 0) {
    const mapsDir = path.join(deps.home ?? os.homedir(), ".airgap", "maps");
    await mkdir(mapsDir, { recursive: true });
    const mapFile = path.join(mapsDir, `${path.basename(outFile)}.json`);
    await writeFile(mapFile, JSON.stringify(redactResult.reverseMap, null, 2), { mode: 0o600 });
    await chmod(mapFile, 0o600);
    log(pc.dim(`反向映射已存 ${mapFile}（0600，仅本机）`));
  }

  const size = (await stat(outFile)).size;
  log(
    `${pc.green("✔")} 已写包 ${pc.bold(outFile)}（${(size / 1024).toFixed(1)} KB，` +
      `${manifest.slice.keptRecords}/${manifest.slice.totalRecords} 条记录，脱敏 ${manifest.redaction.length} 类）`,
  );
  log(pc.dim(`对方拿到后：npx airgap open ${path.basename(outFile)}`));
  return outFile;
}

export function registerPack(program: Command): void {
  program
    .command("pack")
    .description("把一个会话切片、脱敏并打成 .ccpack 便携包")
    .option("--last", "选当前目录项目最近的会话（默认行为）")
    .option("--session <prefix>", "按 sessionId 前缀选会话")
    .option("--tail <n>", "只带最后 N 个用户轮", (v: string) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--tail 需要正整数");
      return n;
    })
    .option("--out <file>", "输出文件（默认 <项目名>-<yyMMdd>.ccpack）")
    .option("--yes", "跳过逐条确认，全部脱敏")
    .option("--no-redact", "不脱敏（必须搭配 --accept-risk）")
    .option("--accept-risk", "确认接受不脱敏的风险")
    .option("--strip-thinking", "剥离 assistant thinking 块（连带去掉加密 signature）")
    .action(async (opts: PackCliOptions) => {
      try {
        await runPack(opts);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
