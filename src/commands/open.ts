import * as clack from "@clack/prompts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import type { Command } from "commander";
import { HOME_TOKEN, PROJECT_ROOT_TOKEN, readPack } from "../ccpack.js";
import { mungeCwd } from "../discovery.js";
import { tryParse } from "../util/jsonl.js";
import { METADATA_KEYS, walkStrings } from "../util/text.js";
import type { PackManifest } from "../types.js";

export interface OpenCliOptions {
  project?: string;
  printOnly?: boolean;
}

export interface OpenDeps {
  home?: string;
  cwd?: string;
  tmpdir?: string;
  interactive?: boolean;
  log?: (line: string) => void;
}

export interface OpenResult {
  newSessionId?: string;
  installedPath?: string;
  extractedDir?: string;
}

/**
 * claude munges realpath(cwd), not the literal path (verified against the
 * 2.1.198 bundle; e.g. /tmp -> /private/tmp on macOS). Fall back to the
 * resolved path when the directory does not exist yet.
 */
async function realpathOrSelf(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return dir;
  }
}

function printReceipt(manifest: PackManifest, log: (l: string) => void): void {
  log(pc.bold("── 信任回执 ────────────────────────────"));
  log(`  producer   ${manifest.producer}  (spec v${manifest.specVersion}, ${manifest.createdAt})`);
  log(`  source     ${manifest.source.tool} ${manifest.source.toolVersion ?? "?"}  dialect ${manifest.source.dialect}`);
  log(`  session    ${manifest.sessionId}${manifest.title ? `  「${manifest.title}」` : ""}`);
  const s = manifest.slice;
  const dropped = Object.entries(s.droppedTypes)
    .map(([t, n]) => `${t}×${n}`)
    .join(" ") || "无";
  log(`  切片       保留 ${s.keptRecords}/${s.totalRecords} 条，工具配对 ${s.toolUsePairs} 对，丢弃：${dropped}`);
  log(`  闭包       ${s.closureComplete ? pc.green("完整") : pc.yellow("不完整（个别工具结果缺失）")}`);
  log(`  sidecar    subagents ${s.subagentFiles} 个 / tool-results ${s.toolResultFiles} 个`);
  if (manifest.redaction.length === 0) {
    log(`  脱敏       ${pc.yellow("0 项（该包声明未做脱敏或无命中）")}`);
  } else {
    log(`  脱敏       ${manifest.redaction.length} 类：`);
    for (const a of manifest.redaction) {
      log(`             [${a.severity}] ${a.ruleId} ×${a.count} → ${a.placeholder}`);
    }
  }
  log(pc.bold("────────────────────────────────────────"));
}

/** Restore path tokens inside a string. */
function restoreTokens(value: string, projectDir: string, home: string): string {
  return value.split(PROJECT_ROOT_TOKEN).join(projectDir).split(HOME_TOKEN).join(home);
}

/**
 * Rewrite one transcript jsonl text: restore path tokens in string values,
 * rewrite top-level sessionId + cwd. uuid/parentUuid stay untouched (tree unchanged).
 * In sidecar files sessionId is only rewritten when it equals the old main session id.
 */
function rewriteJsonl(
  text: string,
  o: { newSessionId: string; oldSessionId: string; projectDir: string; home: string; sidecar: boolean },
): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const json = tryParse(line);
    if (!json) {
      out.push(restoreTokens(line, o.projectDir, o.home));
      continue;
    }
    walkStrings(json, METADATA_KEYS, (value) => {
      const next = restoreTokens(value, o.projectDir, o.home);
      return next === value ? undefined : next;
    });
    if ("sessionId" in json) {
      if (!o.sidecar || json.sessionId === o.oldSessionId) json.sessionId = o.newSessionId;
    }
    if ("cwd" in json && typeof json.cwd === "string") json.cwd = o.projectDir;
    out.push(JSON.stringify(json));
  }
  return out.join("\n") + "\n";
}

async function writeNoClobber(dest: string, content: string): Promise<void> {
  if (existsSync(dest)) throw new Error(`拒绝覆盖已存在文件：${dest}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, content, { flag: "wx" });
}

export async function runOpen(file: string, opts: OpenCliOptions, deps: OpenDeps = {}): Promise<OpenResult> {
  const log = deps.log ?? console.log;
  const home = deps.home ?? os.homedir();
  const packFile = path.resolve(deps.cwd ?? process.cwd(), file);

  const { manifest, extract } = await readPack(packFile);
  printReceipt(manifest, log);

  // extract（同时完成 sha256 校验）
  const tmpBase = deps.tmpdir ?? os.tmpdir();
  const stage = await mkdtemp(path.join(tmpBase, "airgap-open-"));
  await extract(stage);

  if (opts.printOnly) {
    log(`已解包到临时目录（未安装）：`);
    for (const e of manifest.entries) log(`  ${path.join(stage, e.path)}`);
    log(`  ${path.join(stage, "manifest.json")}`);
    return { extractedDir: stage };
  }

  // 目标项目目录：--project > 交互询问 > 当前目录
  let projectDir: string;
  if (opts.project) {
    projectDir = path.resolve(deps.cwd ?? process.cwd(), opts.project);
  } else {
    const fallback = deps.cwd ?? process.cwd();
    const interactive = deps.interactive ?? process.stdin.isTTY === true;
    if (interactive) {
      const answer = await clack.text({
        message: "装到哪个项目目录？（决定 claude 里 resume 的项目归属）",
        initialValue: fallback,
      });
      if (clack.isCancel(answer)) throw new Error("用户取消");
      projectDir = path.resolve(String(answer));
    } else {
      projectDir = fallback;
    }
  }

  // fork 语义：新 sessionId，树（uuid/parentUuid）不动
  projectDir = await realpathOrSelf(projectDir);
  const newSessionId = randomUUID();
  const projectsDir = path.join(home, ".claude", "projects", mungeCwd(projectDir));
  const installedPath = path.join(projectsDir, `${newSessionId}.jsonl`);

  const rewriteOpts = { newSessionId, oldSessionId: manifest.sessionId, projectDir, home };
  const transcriptText = await readFile(path.join(stage, "transcript.jsonl"), "utf8");
  await writeNoClobber(installedPath, rewriteJsonl(transcriptText, { ...rewriteOpts, sidecar: false }));

  for (const entry of manifest.entries) {
    if (entry.role === "transcript") continue;
    const src = path.join(stage, entry.path);
    const base = path.basename(entry.path);
    const destDir =
      entry.role === "tool-result"
        ? path.join(projectsDir, newSessionId, "tool-results")
        : path.join(projectsDir, newSessionId, "subagents");
    const content = await readFile(src, "utf8");
    const rewritten =
      entry.role === "subagent"
        ? rewriteJsonl(content, { ...rewriteOpts, sidecar: true })
        : restoreTokens(content, projectDir, home);
    await writeNoClobber(path.join(destDir, base), rewritten);
  }

  log(`${pc.green("✔")} 已安装为新会话 ${pc.bold(newSessionId)}（fork，不影响任何现有会话）`);
  log(`  ${pc.bold(`cd ${projectDir} && claude --resume ${newSessionId} --fork-session`)}`);
  log(pc.dim(`  兜底（任意目录可用）：claude --resume ${installedPath} --fork-session`));
  log(pc.dim(`  装载机制验证于 claude 2.1.198；升级后若 resume 失败请用兜底命令并报 issue`));
  return { newSessionId, installedPath, extractedDir: stage };
}

export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("校验并安装一个 .ccpack 到本机 claude，生成可 resume 的新会话")
    .argument("<file>", ".ccpack 文件路径")
    .option("--project <dir>", "目标项目目录（默认询问，非交互时取当前目录）")
    .option("--print-only", "只解包到临时目录并打印文件路径，不安装")
    .action(async (file: string, opts: OpenCliOptions) => {
      try {
        await runOpen(file, opts);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
