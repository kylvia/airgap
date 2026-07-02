import * as clack from "@clack/prompts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import type { Command } from "commander";
import { HOME_TOKEN, PROJECT_ROOT_TOKEN, readPack } from "../ccpack.js";
import { scanString } from "../detect/scanner.js";
import { mungeCwd } from "../discovery.js";
import { tryParse } from "../util/jsonl.js";
import { sanitizeForTerminal } from "../util/terminal.js";
import { METADATA_KEYS, walkStrings } from "../util/text.js";
import type { PackManifest } from "../types.js";

export interface OpenCliOptions {
  project?: string;
  printOnly?: boolean;
  acceptRisk?: boolean;
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

/** Every manifest-derived string is untrusted: strip terminal control sequences. */
const clean = sanitizeForTerminal;

function printReceipt(manifest: PackManifest, log: (l: string) => void): void {
  log(pc.bold("── 信任回执 ────────────────────────────"));
  log(`  producer   ${clean(manifest.producer)}  (spec v${manifest.specVersion}, ${clean(manifest.createdAt)})`);
  log(
    `  source     ${clean(manifest.source.tool)} ${clean(manifest.source.toolVersion ?? "?")}  dialect ${clean(manifest.source.dialect)}`,
  );
  log(`  session    ${clean(manifest.sessionId)}${manifest.title ? `  「${clean(manifest.title)}」` : ""}`);
  const s = manifest.slice;
  const dropped = Object.entries(s.droppedTypes)
    .map(([t, n]) => `${clean(t)}×${n}`)
    .join(" ") || "无";
  log(`  切片       保留 ${s.keptRecords}/${s.totalRecords} 条，工具配对 ${s.toolUsePairs} 对，丢弃：${dropped}`);
  log(`  闭包       ${s.closureComplete ? pc.green("完整") : pc.yellow("不完整（个别工具结果缺失）")}`);
  log(`  sidecar    subagents ${s.subagentFiles} 个 / tool-results ${s.toolResultFiles} 个`);
  if (manifest.redaction.length === 0) {
    log(`  脱敏       ${pc.yellow("0 项（该包自述未做脱敏或无命中，未经 open 独立验证）")}`);
  } else {
    log(`  脱敏       ${manifest.redaction.length} 类（该包自述，未经 open 独立验证）：`);
    for (const a of manifest.redaction) {
      log(`             [${clean(a.severity)}] ${clean(a.ruleId)} ×${a.count} → ${clean(a.placeholder)}`);
    }
  }
  log(pc.bold("────────────────────────────────────────"));
}

/**
 * Re-scan every extracted file (transcript + all sidecars) with the real
 * scanner. The manifest's redaction claims are self-reported and not integrity
 * bound, so open never trusts them: if any plaintext secret survives, install
 * is refused unless the operator passes --accept-risk.
 */
async function rescanStage(
  stage: string,
  manifest: PackManifest,
): Promise<Array<{ file: string; ruleId: string; preview: string; severity: string }>> {
  const hits: Array<{ file: string; ruleId: string; preview: string; severity: string }> = [];
  const files = new Set<string>(["transcript.jsonl"]);
  for (const e of manifest.entries) files.add(e.path);
  for (const rel of files) {
    const abs = path.join(stage, rel);
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    for (const m of scanString(text)) {
      hits.push({ file: rel, ruleId: m.ruleId, preview: m.preview, severity: m.severity });
    }
  }
  return hits;
}

/**
 * A resolved token → replacement table, built only from tokens the manifest
 * actually declares in pathTokens. Literal `{{HOME}}`/`{{PROJECT_ROOT}}` that a
 * user typed into their content are NOT restored unless the pack tokenized them
 * (F8): if the manifest never listed a token, it stays as-is.
 */
export type TokenTable = Array<{ token: string; value: string }>;

/**
 * Build the restore table. `manifest.pathTokens` maps token → the original
 * absolute path captured at pack time; on this machine we map:
 *   {{PROJECT_ROOT}} -> local target project dir
 *   {{HOME}}         -> local home
 * Any other declared token restores to its manifest-recorded original path
 * (best effort — unknown tokens are still only restored if the pack declared
 * them, never invented here).
 */
function buildRestoreTable(
  pathTokens: Record<string, string> | undefined,
  projectDir: string,
  home: string,
): TokenTable {
  const table: TokenTable = [];
  for (const token of Object.keys(pathTokens ?? {})) {
    if (token === PROJECT_ROOT_TOKEN) table.push({ token, value: projectDir });
    else if (token === HOME_TOKEN) table.push({ token, value: home });
    else table.push({ token, value: pathTokens![token]! });
  }
  return table;
}

/**
 * Restore path tokens inside a string in a single left-to-right scan so a value
 * produced by one restore can never be re-tokenized by the next, and only the
 * declared tokens are ever touched.
 */
function restoreTokens(value: string, table: TokenTable): string {
  if (table.length === 0) return value;
  let out = "";
  let i = 0;
  outer: while (i < value.length) {
    for (const { token, value: repl } of table) {
      if (value.startsWith(token, i)) {
        out += repl;
        i += token.length;
        continue outer;
      }
    }
    out += value[i];
    i += 1;
  }
  return out;
}

/**
 * Rewrite one transcript jsonl text: restore path tokens in string values,
 * rewrite top-level sessionId + cwd. uuid/parentUuid stay untouched (tree unchanged).
 * In sidecar files sessionId is only rewritten when it equals the old main session id.
 */
function rewriteJsonl(
  text: string,
  o: { newSessionId: string; oldSessionId: string; projectDir: string; tokens: TokenTable; sidecar: boolean },
): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const json = tryParse(line);
    if (!json) {
      out.push(restoreTokens(line, o.tokens));
      continue;
    }
    walkStrings(json, METADATA_KEYS, (value) => {
      const next = restoreTokens(value, o.tokens);
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

  // F11: 只有 claude 谱系的包才能装进 ~/.claude。codex 包（或方言不以
  // claude-jsonl-tree/ 开头）装进去必然产生无法 resume 的会话，除 --print-only
  // 外，在任何文件写入 / 落盘之前就拒绝。
  const isClaude = manifest.source.tool === "claude" && manifest.source.dialect.startsWith("claude-jsonl-tree/");
  if (!opts.printOnly && !isClaude) {
    throw new Error(
      `该包来源为 ${manifest.source.tool}（dialect ${manifest.source.dialect}），open 暂不支持安装非 claude 包；` +
        `可用 --print-only 解包查看内容。`,
    );
  }

  // extract（同时完成 sha256 校验）
  const tmpBase = deps.tmpdir ?? os.tmpdir();
  const stage = await mkdtemp(path.join(tmpBase, "airgap-open-"));
  await extract(stage);

  if (opts.printOnly) {
    // F9: print-only 保留 stage（用户要拿路径），不进 finally 清理分支。
    log(`已解包到临时目录（未安装）：`);
    for (const e of manifest.entries) log(`  ${path.join(stage, e.path)}`);
    log(`  ${path.join(stage, "manifest.json")}`);
    return { extractedDir: stage };
  }

  // 安装分支：无论成功或异常，finally 里都清掉解包目录（F9），避免明文
  // transcript + sidecar 滞留 os.tmpdir()。
  try {
    // F7: manifest.redaction 无完整性绑定，安装前对解包内容独立重扫。
    const hits = await rescanStage(stage, manifest);
    if (hits.length > 0) {
      log(pc.red(pc.bold(`⚠ 独立重扫发现该包仍含 ${hits.length} 处明文疑似密钥（manifest 的脱敏自述不可信）：`)));
      for (const h of hits) {
        log(pc.red(`    [${clean(h.severity)}] ${clean(h.ruleId)}  ${clean(h.preview)}  @ ${clean(h.file)}`));
      }
      if (!opts.acceptRisk) {
        throw new Error("默认拒绝安装含明文密钥的包；确认风险后可加 --accept-risk 显式放行。");
      }
      log(pc.yellow("  --accept-risk 已指定：明知含明文仍继续安装。"));
    } else {
      log(pc.green(`✔ 独立重扫未发现明文密钥（open 自验，非仅凭 manifest 自述）`));
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

    // F8: 只按 manifest.pathTokens 里声明过的 token 还原，避免误还原用户
    // 内容里的字面 {{HOME}}/{{PROJECT_ROOT}}。
    const tokens = buildRestoreTable(manifest.pathTokens, projectDir, home);
    const rewriteOpts = { newSessionId, oldSessionId: manifest.sessionId, projectDir, tokens };
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
          : restoreTokens(content, tokens);
      await writeNoClobber(path.join(destDir, base), rewritten);
    }

    log(`${pc.green("✔")} 已安装为新会话 ${pc.bold(newSessionId)}（fork，不影响任何现有会话）`);
    log(`  ${pc.bold(`cd ${projectDir} && claude --resume ${newSessionId} --fork-session`)}`);
    log(pc.dim(`  兜底（任意目录可用）：claude --resume ${installedPath} --fork-session`));
    log(pc.dim(`  装载机制验证于 claude 2.1.198；升级后若 resume 失败请用兜底命令并报 issue`));
    // F9: 安装成功不再返回 extractedDir（stage 已在 finally 清除）。
    return { newSessionId, installedPath };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("Verify and install a .ccpack into local claude as a new resumable session")
    .argument("<file>", "path to the .ccpack file")
    .option("--project <dir>", "target project directory (prompts by default, uses cwd when non-interactive)")
    .option("--print-only", "only extract to a temp directory and print file paths, do not install")
    .option("--accept-risk", "install anyway when the independent re-scan finds plaintext secrets (refused by default)")
    .action(async (file: string, opts: OpenCliOptions) => {
      try {
        await runOpen(file, opts);
      } catch (err) {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });
}
