import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { tryParse } from "./util/jsonl.js";
import { METADATA_KEYS, walkStrings } from "./util/text.js";
import { SPEC_VERSION } from "./types.js";
import type { PackManifest, RedactResult, SlicedSession } from "./types.js";

const require = createRequire(import.meta.url);

function airgapVersion(): string {
  for (const p of ["../package.json", "../../package.json"]) {
    try {
      return (require(p) as { version: string }).version;
    } catch {
      /* keep looking */
    }
  }
  return "0.0.0";
}

export const PROJECT_ROOT_TOKEN = "{{PROJECT_ROOT}}";
export const HOME_TOKEN = "{{HOME}}";

/** token -> original absolute path, ordered so the longer/more specific path applies first. */
function buildPathTokens(cwd: string | null, home: string): Array<[string, string]> {
  const tokens: Array<[string, string]> = [];
  if (cwd && cwd !== home) tokens.push([PROJECT_ROOT_TOKEN, cwd]);
  if (home) tokens.push([HOME_TOKEN, home]);
  return tokens;
}

function applyTokensToText(text: string, tokens: Array<[string, string]>): string {
  let out = text;
  for (const [token, original] of tokens) out = out.split(original).join(token);
  return out;
}

/** Tokenize a jsonl line: only string values are touched, metadata keys skipped. */
function tokenizeRecordLine(raw: string, tokens: Array<[string, string]>): string {
  const json = tryParse(raw);
  if (!json) return applyTokensToText(raw, tokens);
  let mutated = false;
  walkStrings(json, METADATA_KEYS, (value) => {
    const next = applyTokensToText(value, tokens);
    if (next === value) return undefined;
    mutated = true;
    return next;
  });
  return mutated ? JSON.stringify(json) : raw;
}

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Reject zip entry paths that could escape the extraction directory (zip-slip). */
export function assertSafeEntryPath(entryPath: string): void {
  const norm = entryPath.replace(/\\/g, "/");
  if (norm.length === 0) throw new Error("zip-slip rejected: empty entry path");
  if (/^[a-zA-Z]:/.test(norm) || norm.startsWith("/")) {
    throw new Error(`zip-slip rejected: absolute entry path "${entryPath}"`);
  }
  if (norm.split("/").includes("..")) {
    throw new Error(`zip-slip rejected: ".." in entry path "${entryPath}"`);
  }
}

/**
 * Write a .ccpack (zip) with layout:
 *   manifest.json / transcript.jsonl / subagents/* / tool-results/*
 * Project/home absolute paths inside record contents are replaced with
 * {{PROJECT_ROOT}} / {{HOME}} tokens before writing.
 */
export async function writePack(
  outFile: string,
  sliced: SlicedSession,
  redact: RedactResult,
  extra: { toolVersion: string | null },
): Promise<PackManifest> {
  const home = os.homedir();
  const tokens = buildPathTokens(sliced.info.cwd, home);

  const entries: PackManifest["entries"] = [];
  const zip = new yazl.ZipFile();

  const transcriptText = redact.records.map((r) => tokenizeRecordLine(r.raw, tokens)).join("\n") + "\n";
  const transcriptBuf = Buffer.from(transcriptText, "utf8");
  zip.addBuffer(transcriptBuf, "transcript.jsonl");
  entries.push({ path: "transcript.jsonl", sha256: sha256Buffer(transcriptBuf), role: "transcript" });

  for (const file of sliced.sidecars.subagents) {
    const base = path.basename(file);
    const zipPath = `subagents/${base}`;
    const text = await readFile(file, "utf8");
    const buf = Buffer.from(applyTokensToText(text, tokens), "utf8");
    zip.addBuffer(buf, zipPath);
    entries.push({ path: zipPath, sha256: sha256Buffer(buf), role: base.endsWith(".meta.json") ? "meta" : "subagent" });
  }

  for (const file of sliced.sidecars.toolResults) {
    const base = path.basename(file);
    const zipPath = `tool-results/${base}`;
    const text = await readFile(file, "utf8");
    const buf = Buffer.from(applyTokensToText(text, tokens), "utf8");
    zip.addBuffer(buf, zipPath);
    entries.push({ path: zipPath, sha256: sha256Buffer(buf), role: "tool-result" });
  }

  // title from a carried summary record, when present
  let title: string | undefined;
  for (const r of redact.records) {
    if (r.json?.type === "summary" && typeof r.json.summary === "string") {
      title = r.json.summary;
      break;
    }
  }

  const manifest: PackManifest = {
    specVersion: SPEC_VERSION,
    producer: `airgap/${airgapVersion()}`,
    createdAt: new Date().toISOString(),
    source: {
      tool: sliced.info.source,
      toolVersion: extra.toolVersion,
      dialect: sliced.info.source === "claude" ? "claude-jsonl-tree/1" : "codex-rollout/1",
    },
    sessionId: sliced.info.id,
    ...(title !== undefined ? { title } : {}),
    pathTokens: Object.fromEntries(tokens),
    entries,
    redaction: redact.annotations,
    slice: sliced.report,
  };

  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), "manifest.json");
  zip.end();

  await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
  await pipeline(zip.outputStream, createWriteStream(outFile));
  return manifest;
}

function readAllEntries(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error(`cannot open ${file}`));
      const entries = new Map<string, Buffer>();
      let failed = false;
      const fail = (e: unknown): void => {
        if (failed) return;
        failed = true;
        try {
          zipfile.close();
        } catch {
          /* already closed */
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      zipfile.on("error", fail);
      zipfile.on("entry", (entry: yauzl.Entry) => {
        try {
          assertSafeEntryPath(entry.fileName);
        } catch (e) {
          return fail(e);
        }
        if (entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) return fail(err2 ?? new Error(`cannot read ${entry.fileName}`));
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c as Buffer));
          stream.on("error", fail);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
        });
      });
      zipfile.on("end", () => {
        if (!failed) resolve(entries);
      });
      zipfile.readEntry();
    });
  });
}

/**
 * Read a .ccpack: returns the manifest plus a lazy extractor.
 * Entry paths are validated against zip-slip at read time; extraction verifies
 * each entry's sha256 against the manifest and never overwrites existing files.
 */
export async function readPack(
  file: string,
): Promise<{ manifest: PackManifest; extract(destDir: string): Promise<void> }> {
  const entries = await readAllEntries(file);
  const manifestBuf = entries.get("manifest.json");
  if (!manifestBuf) throw new Error(`${file} is not a ccpack: manifest.json missing`);
  const manifest = JSON.parse(manifestBuf.toString("utf8")) as PackManifest;
  if (typeof manifest.specVersion !== "number" || manifest.specVersion > SPEC_VERSION) {
    throw new Error(`unsupported ccpack specVersion: ${String(manifest.specVersion)} (supported: <=${SPEC_VERSION})`);
  }

  const extract = async (destDir: string): Promise<void> => {
    const destRoot = path.resolve(destDir);
    for (const listed of manifest.entries) {
      if (!entries.has(listed.path)) throw new Error(`ccpack corrupt: entry ${listed.path} listed but missing`);
    }
    for (const [name, buf] of entries) {
      assertSafeEntryPath(name);
      const listed = manifest.entries.find((e) => e.path === name);
      if (listed && sha256Buffer(buf) !== listed.sha256) {
        throw new Error(`sha256 mismatch for ${name}: pack is corrupt or tampered`);
      }
      const dest = path.resolve(destRoot, name);
      const rel = path.relative(destRoot, dest);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`zip-slip rejected: "${name}" escapes destination`);
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf, { flag: "wx" }); // never overwrite
    }
  };

  return { manifest, extract };
}
