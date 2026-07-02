import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { DiscoverOptions, SessionInfo, SidecarFiles } from "./types.js";
import { streamLines, tryParse } from "./util/jsonl.js";

/**
 * Munge a cwd into Claude's project directory name. Verified against the
 * claude 2.1.198 bundle: every non-alphanumeric character becomes `-`, and
 * claude applies it to realpath(cwd) — callers must resolve symlinks first
 * (e.g. /tmp -> /private/tmp on macOS) before munging.
 */
export function mungeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectsDir(home: string): string {
  return join(home, ".claude", "projects");
}

export function codexSessionsDir(home: string): string {
  return join(home, ".codex", "sessions");
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Cheap metadata peek: find the session's original cwd from the first few records.
 * Claude records carry a top-level `cwd`; codex rollouts carry it in the session_meta
 * payload. Some claude files start with a `summary` record without cwd, so we look at
 * up to `maxLines` records instead of only the first.
 */
async function peekCwd(file: string, maxLines: number): Promise<string | null> {
  let seen = 0;
  for await (const { line } of streamLines(file)) {
    if (++seen > maxLines) break;
    const json = tryParse(line);
    if (json === null) continue;
    if (typeof json.cwd === "string") return json.cwd;
    const payload = json.payload;
    if (
      payload !== null &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).cwd === "string"
    ) {
      return (payload as Record<string, unknown>).cwd as string;
    }
  }
  return null;
}

async function collectSidecars(projDir: string, sid: string): Promise<SidecarFiles> {
  const base = join(projDir, sid);
  const subagents: string[] = [];
  const subagentsDir = join(base, "subagents");
  for (const e of await safeReaddir(subagentsDir)) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith("agent-")) continue;
    if (e.name.endsWith(".jsonl") || e.name.endsWith(".meta.json")) {
      subagents.push(join(subagentsDir, e.name));
    }
  }
  const toolResults: string[] = [];
  const toolResultsDir = join(base, "tool-results");
  for (const e of await safeReaddir(toolResultsDir)) {
    if (e.isFile() && e.name.endsWith(".txt")) toolResults.push(join(toolResultsDir, e.name));
  }
  subagents.sort();
  toolResults.sort();
  return { subagents, toolResults };
}

async function discoverClaude(home: string): Promise<SessionInfo[]> {
  const root = claudeProjectsDir(home);
  const out: SessionInfo[] = [];
  for (const projEntry of await safeReaddir(root)) {
    if (!projEntry.isDirectory()) continue;
    const projDir = join(root, projEntry.name);
    for (const e of await safeReaddir(projDir)) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const file = join(projDir, e.name);
      let st;
      try {
        st = await stat(file);
      } catch {
        continue;
      }
      const id = e.name.slice(0, -".jsonl".length);
      const cwd = await peekCwd(file, 25);
      out.push({
        source: "claude",
        id,
        file,
        cwd,
        project: cwd ?? projEntry.name,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
        sidecars: await collectSidecars(projDir, id),
      });
    }
  }
  return out;
}

const ROLLOUT_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

async function discoverCodex(home: string): Promise<SessionInfo[]> {
  const root = codexSessionsDir(home);
  const out: SessionInfo[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const e of await safeReaddir(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.isFile() || !e.name.startsWith("rollout-") || !e.name.endsWith(".jsonl")) continue;
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      const id = ROLLOUT_UUID.exec(e.name)?.[1] ?? basename(e.name, ".jsonl");
      const cwd = await peekCwd(p, 5);
      out.push({
        source: "codex",
        id,
        file: p,
        cwd,
        project: cwd ?? basename(e.name, ".jsonl"),
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
        sidecars: { subagents: [], toolResults: [] },
      });
    }
  }
  return out;
}

/** Discover sessions from both local stores, newest first. Missing dirs are fine. */
export async function discoverSessions(opts: DiscoverOptions): Promise<SessionInfo[]> {
  const home = opts.home ?? homedir();
  const sources = opts.sources ?? ["claude", "codex"];
  const out: SessionInfo[] = [];
  if (sources.includes("claude")) out.push(...(await discoverClaude(home)));
  if (sources.includes("codex")) out.push(...(await discoverCodex(home)));
  const needle = opts.project;
  const filtered = needle
    ? out.filter((s) => s.project.includes(needle) || (s.cwd ?? "").includes(needle))
    : out;
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered;
}
