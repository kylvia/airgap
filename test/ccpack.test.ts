import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yazl from "yazl";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertSafeEntryPath, readPack, writePack } from "../src/ccpack.js";
import type { SidecarContent } from "../src/ccpack.js";
import { runOpen } from "../src/commands/open.js";
import { runPack } from "../src/commands/pack.js";
import { createRedactor } from "../src/redact.js";
import { sliceSession } from "../src/slice.js";
import { sha256String } from "../src/util/text.js";
import type { RuleMatch, SessionInfo } from "../src/types.js";
import { FIXTURE_CWD, SECRET, SID, writeFixtureSession } from "./fixtures/claude-session.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "airgap-ccpack-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const info: SessionInfo = writeFixtureSession(path.join(tmp, "home"));

/** contract-shaped scanner mock (scanString signature) — no A 组 import */
const fakeScan = vi.fn((s: string): RuleMatch[] =>
  s.includes(SECRET) ? [{ ruleId: "test-key", severity: "critical", secret: SECRET, preview: "sk-t…1234" }] : [],
);

const readText = async (file: string): Promise<string> =>
  (await import("node:fs/promises")).readFile(file, "utf8");

/** Build a pack the way runPack does: one shared redactor across transcript + sidecars. */
async function buildPack(outFile: string) {
  const sliced = await sliceSession(info, {});
  const redactor = createRedactor(fakeScan);
  const records = redactor.redactRecords(sliced.records);
  const sidecarContents: SidecarContent[] = [];
  for (const f of sliced.sidecars.subagents) {
    const base = path.basename(f);
    const role = base.endsWith(".meta.json") ? "meta" : "subagent";
    const text = await readText(f);
    const lines = text.split("\n");
    const had = text.endsWith("\n");
    if (had) lines.pop();
    const content =
      lines
        .map((line, i) => {
          if (line.length === 0) return line;
          const json = JSON.parse(line) as Record<string, unknown>;
          return redactor.redactRecords([{ raw: line, lineNo: i + 1, json }])[0]!.raw;
        })
        .join("\n") + (had ? "\n" : "");
    sidecarContents.push({ path: `subagents/${base}`, role, content });
  }
  for (const f of sliced.sidecars.toolResults) {
    const base = path.basename(f);
    sidecarContents.push({ path: `tool-results/${base}`, role: "tool-result", content: redactor.redactText(await readText(f)) });
  }
  const { annotations, reverseMap } = redactor.result();
  const redact = { records, annotations, reverseMap };
  const manifest = await writePack(outFile, sliced, redact, { toolVersion: "2.1.198", sidecarContents });
  return { sliced, redact, manifest, placeholder: reverseMap[SECRET]! };
}

describe("writePack -> readPack roundtrip", () => {
  it("produces a manifest matching the contract shape", async () => {
    const out = path.join(tmp, "roundtrip.ccpack");
    const { manifest, placeholder } = await buildPack(out);

    expect(manifest.specVersion).toBe(1);
    expect(manifest.producer).toMatch(/^airgap\//);
    expect(manifest.sessionId).toBe(SID);
    expect(manifest.title).toBe("Demo session title");
    expect(manifest.source).toEqual({ tool: "claude", toolVersion: "2.1.198", dialect: "claude-jsonl-tree/1" });
    expect(manifest.pathTokens).toEqual({ "{{PROJECT_ROOT}}": FIXTURE_CWD, "{{HOME}}": os.homedir() });
    // F5: placeholder is a per-pack random token, not sha256(secret)-derived.
    expect(placeholder).toMatch(/^TEST-KEY-REDACTED-[0-9a-f]{6}$/);
    expect(placeholder).not.toContain(sha256String(SECRET).slice(0, 6));
    expect(manifest.redaction).toEqual([
      { ruleId: "test-key", severity: "critical", placeholder, count: 1 },
    ]);
    expect(manifest.slice.keptRecords).toBe(13);

    const roles = Object.fromEntries(manifest.entries.map((e) => [e.path, e.role]));
    expect(roles).toEqual({
      "transcript.jsonl": "transcript",
      "subagents/agent-aaa.jsonl": "subagent",
      "subagents/agent-aaa.meta.json": "meta",
      "tool-results/toolu_01.txt": "tool-result",
      "tool-results/toolu_02.txt": "tool-result",
    });
    for (const e of manifest.entries) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);

    const { manifest: readBack } = await readPack(out);
    expect(readBack).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  it("tokenizes project/home paths in contents, keeps secrets redacted, verifies sha256 on extract", async () => {
    const out = path.join(tmp, "extract.ccpack");
    const { manifest, placeholder } = await buildPack(out);
    const { extract } = await readPack(out);
    const dest = path.join(tmp, "extracted");
    await extract(dest);

    const transcript = readFileSync(path.join(dest, "transcript.jsonl"), "utf8");
    expect(transcript).toContain("cat {{PROJECT_ROOT}}/a.txt");
    expect(transcript).toContain("{{HOME}}/notes.txt");
    expect(transcript).not.toContain(FIXTURE_CWD);
    expect(transcript).not.toContain(os.homedir());
    expect(transcript).not.toContain(SECRET);
    expect(transcript).toContain(placeholder);
    // metadata like sessionId is untouched by tokenization
    expect(transcript).toContain(SID);

    const entry = manifest.entries.find((e) => e.path === "transcript.jsonl");
    expect(sha256String(transcript)).toBe(entry?.sha256);

    // sidecars extracted and tokenized too
    expect(readFileSync(path.join(dest, "subagents", "agent-aaa.jsonl"), "utf8")).toContain("{{PROJECT_ROOT}}/sub");
    expect(readFileSync(path.join(dest, "tool-results", "toolu_01.txt"), "utf8")).toContain("{{PROJECT_ROOT}}/a.txt");

    // never overwrites existing files
    await expect(extract(dest)).rejects.toThrow();
  });

  it("rejects a pack whose content was tampered (sha256 mismatch)", async () => {
    const out = path.join(tmp, "tampered-src.ccpack");
    await buildPack(out);
    const { manifest } = await readPack(out);

    // rebuild a zip that keeps the honest manifest but swaps the transcript content
    const tamperedManifest = {
      ...manifest,
      entries: manifest.entries.filter((e) => e.path === "transcript.jsonl"),
    };
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('{"type":"user","message":{"content":"tampered"}}\n'), "transcript.jsonl");
    zip.addBuffer(Buffer.from(JSON.stringify(tamperedManifest)), "manifest.json");
    zip.end();
    const tamperedFile = path.join(tmp, "tampered.ccpack");
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      zip.outputStream.on("data", (c) => chunks.push(c as Buffer));
      zip.outputStream.on("end", () => resolve());
      zip.outputStream.on("error", reject);
    });
    writeFileSync(tamperedFile, Buffer.concat(chunks));

    const reread = await readPack(tamperedFile);
    await expect(reread.extract(path.join(tmp, "tampered-out"))).rejects.toThrow(/sha256/);
  });
});

describe("zip-slip protection", () => {
  it("assertSafeEntryPath rejects escapes and absolute paths", () => {
    expect(() => assertSafeEntryPath("../evil")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("a/../../b")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("/abs/path")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("C:/windows")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("a\\..\\b")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("")).toThrow(/zip-slip/);
    expect(() => assertSafeEntryPath("ok/file.txt")).not.toThrow();
    expect(() => assertSafeEntryPath("subagents/agent-a.jsonl")).not.toThrow();
  });

  it("readPack rejects a zip containing a ../ entry (byte-patched malicious zip)", async () => {
    const evil = path.join(tmp, "evil.ccpack");
    await buildMaliciousZip(evil, "../e");
    await expect(readPack(evil)).rejects.toThrow(/zip-slip|invalid relative path/);
  });

  it("readPack rejects a zip containing an absolute-path entry", async () => {
    const evil = path.join(tmp, "evil-abs.ccpack");
    await buildMaliciousZip(evil, "/abc");
    await expect(readPack(evil)).rejects.toThrow(/zip-slip|absolute path/);
  });
});

/** build a zip with an entry named "evil", then byte-patch the name to a hostile same-length one */
async function buildMaliciousZip(file: string, hostileName4: string): Promise<void> {
  expect(hostileName4).toHaveLength(4);
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from("boom"), "evil");
  zip.addBuffer(Buffer.from("{}"), "manifest.json");
  zip.end();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (c) => chunks.push(c as Buffer));
    zip.outputStream.on("end", () => resolve());
    zip.outputStream.on("error", reject);
  });
  const buf = Buffer.concat(chunks);
  const needle = Buffer.from("evil");
  const patch = Buffer.from(hostileName4);
  let idx = buf.indexOf(needle);
  while (idx !== -1) {
    patch.copy(buf, idx);
    idx = buf.indexOf(needle, idx + 1);
  }
  writeFileSync(file, buf);
}

describe("pack/open command smoke (--yes / --print-only, temp dirs only)", () => {
  it("runPack --yes writes the pack and a 0600 reverse map under <home>/.airgap/maps", async () => {
    const fakeHome = path.join(tmp, "fake-home-pack");
    const out = path.join(tmp, "smoke.ccpack");
    const logs: string[] = [];
    const outFile = await runPack(
      { yes: true, last: true, out },
      {
        discover: async () => [info],
        scan: fakeScan,
        home: fakeHome,
        cwd: FIXTURE_CWD,
        interactive: false,
        log: (l) => logs.push(l),
      },
    );
    expect(outFile).toBe(out);
    expect(existsSync(out)).toBe(true);

    const mapFile = path.join(fakeHome, ".airgap", "maps", "smoke.ccpack.json");
    expect(existsSync(mapFile)).toBe(true);
    expect(statSync(mapFile).mode & 0o777).toBe(0o600);
    const map = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string>;
    expect(Object.keys(map)).toEqual([SECRET]);
    expect(map[SECRET]).toMatch(/^TEST-KEY-REDACTED-[0-9a-f]{6}$/);
  });

  it("runPack refuses --no-redact without --accept-risk", async () => {
    await expect(
      runPack(
        { yes: true, redact: false, out: path.join(tmp, "never.ccpack") },
        { discover: async () => [info], scan: fakeScan, home: path.join(tmp, "h2"), cwd: FIXTURE_CWD, interactive: false, log: () => {} },
      ),
    ).rejects.toThrow(/accept-risk/);
  });

  it("runOpen --print-only extracts to a temp dir without installing", async () => {
    const out = path.join(tmp, "openme.ccpack");
    await buildPack(out);
    const result = await runOpen(out, { printOnly: true }, { tmpdir: tmp, log: () => {} });
    expect(result.extractedDir).toBeDefined();
    expect(result.newSessionId).toBeUndefined();
    expect(existsSync(path.join(result.extractedDir!, "transcript.jsonl"))).toBe(true);
    expect(existsSync(path.join(result.extractedDir!, "manifest.json"))).toBe(true);
  });

  it("runOpen installs a fork: new sessionId + rewritten cwd + restored paths, tree untouched", async () => {
    const out = path.join(tmp, "install.ccpack");
    await buildPack(out);
    const fakeHome = path.join(tmp, "fake-home-open");
    const targetProj = path.join(tmp, "target-proj");
    const result = await runOpen(
      out,
      { project: targetProj },
      { home: fakeHome, tmpdir: tmp, interactive: false, log: () => {} },
    );

    const newSid = result.newSessionId!;
    expect(newSid).toMatch(/^[0-9a-f-]{36}$/);
    expect(newSid).not.toBe(SID);

    const munged = targetProj.replace(/[/.]/g, "-");
    const installed = path.join(fakeHome, ".claude", "projects", munged, `${newSid}.jsonl`);
    expect(result.installedPath).toBe(installed);
    expect(existsSync(installed)).toBe(true);

    const lines = readFileSync(installed, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const j of lines) {
      if ("sessionId" in j) expect(j.sessionId).toBe(newSid);
      if ("cwd" in j) expect(j.cwd).toBe(targetProj);
    }
    // tree unchanged
    const u3 = lines.find((j) => j.uuid === "u3") as { parentUuid: string; message: { content: Array<{ input: { command: string } }> } };
    expect(u3.parentUuid).toBe("u2");
    expect(u3.message.content[0]!.input.command).toBe(`cat ${targetProj}/a.txt`);
    // {{HOME}} restored to the local (fake) home
    const u7 = lines.find((j) => j.uuid === "u7") as { message: { content: string } };
    expect(u7.message.content).toContain(`${fakeHome}/notes.txt`);
    // secret stays redacted after install
    expect(readFileSync(installed, "utf8")).not.toContain(SECRET);

    // sidecars installed next to the new session, rewritten too
    const agent = path.join(fakeHome, ".claude", "projects", munged, newSid, "subagents", "agent-aaa.jsonl");
    expect(existsSync(agent)).toBe(true);
    const agentRec = JSON.parse(readFileSync(agent, "utf8").trim()) as Record<string, unknown>;
    expect(agentRec.sessionId).toBe(newSid); // was the old SID -> follows the fork
    expect(agentRec.cwd).toBe(targetProj);
    expect(existsSync(path.join(fakeHome, ".claude", "projects", munged, newSid, "tool-results", "toolu_01.txt"))).toBe(true);
  });
});

describe("F1: sidecars are redacted, not bypassed", () => {
  // three DISTINCT secrets, one per sidecar file kind + one shared across two files.
  const SUB_SECRET = "sk-ant-SUBAGENTSECRETaaaabbbbcccc";
  const META_SECRET = "ghp_METAONLY0000000000000000000000000000";
  const TR_SECRET = "sk-ant-TOOLRESULTsecretxxxxyyyyzzzz";
  const SHARED = "sk-ant-SHAREDacrossmainANDsidecar1234";

  const multiScan = vi.fn((s: string): RuleMatch[] => {
    const out: RuleMatch[] = [];
    const push = (id: string, secret: string): void => {
      if (s.includes(secret)) out.push({ ruleId: id, severity: "critical", secret, preview: "x" });
    };
    push("anthropic-key", SUB_SECRET);
    push("github-token", META_SECRET);
    push("anthropic-key", TR_SECRET);
    push("anthropic-key", SHARED);
    return out;
  });

  function writeSessionWithSidecarSecrets(baseDir: string): SessionInfo {
    const sid = "44444444-4444-4444-8444-444444444444";
    const projDir = path.join(baseDir, "-Users-tester-f1");
    const sideDir = path.join(projDir, sid);
    const subDir = path.join(sideDir, "subagents");
    const trDir = path.join(sideDir, "tool-results");
    for (const d of [subDir, trDir]) mkdirSync(d, { recursive: true });

    const l = (o: Record<string, unknown>): string => JSON.stringify(o);
    const file = path.join(projDir, `${sid}.jsonl`);
    writeFileSync(
      file,
      [
        l({ type: "user", uuid: "u1", parentUuid: null, sessionId: sid, cwd: FIXTURE_CWD, message: { role: "user", content: "go" } }),
        // reference agent-f1 (pulls in its jsonl + meta) and toolu_f1 so slice keeps them.
        l({ type: "assistant", uuid: "u2", parentUuid: "u1", sessionId: sid, message: { id: "m", role: "assistant", content: [{ type: "text", text: `main sees ${SHARED}; spawned agent-f1; see toolu_f1` }] } }),
      ].join("\n") + "\n",
    );

    const subFile = path.join(subDir, "agent-f1.jsonl");
    writeFileSync(
      subFile,
      l({ type: "user", uuid: "a1", parentUuid: null, sessionId: sid, message: { role: "user", content: `subagent used ${SUB_SECRET} and ${SHARED}` } }) + "\n",
    );
    const metaFile = path.join(subDir, "agent-f1.meta.json");
    writeFileSync(metaFile, l({ agentId: "agent-f1", note: `meta has ${META_SECRET}` }) + "\n");

    const trFile = path.join(trDir, "toolu_f1.txt");
    writeFileSync(trFile, `tool output line\ntoken: ${TR_SECRET}\nmore output\n`);

    return {
      source: "claude",
      id: sid,
      file,
      cwd: FIXTURE_CWD,
      project: FIXTURE_CWD,
      mtimeMs: statSync(file).mtimeMs,
      sizeBytes: statSync(file).size,
      sidecars: { subagents: [subFile, metaFile], toolResults: [trFile] },
    };
  }

  it("no sidecar secret appears in any pack byte; manifest counts sidecar hits; shared secret consistent across files", async () => {
    const home = path.join(tmp, "f1-home");
    const sessionInfo = writeSessionWithSidecarSecrets(path.join(tmp, "f1-src"));
    const out = path.join(tmp, "f1.ccpack");
    await runPack(
      { yes: true, out },
      { discover: async () => [sessionInfo], scan: multiScan, home, cwd: FIXTURE_CWD, interactive: false, log: () => {} },
    );

    // every raw byte of the pack must be free of every plaintext secret
    const packBytes = readFileSync(out).toString("latin1");
    for (const s of [SUB_SECRET, META_SECRET, TR_SECRET, SHARED]) {
      expect(packBytes.includes(s), `plaintext leaked: ${s}`).toBe(false);
    }

    const { manifest, extract } = await readPack(out);
    // manifest.redaction accounts for sidecar-only secrets (META_SECRET lives only in meta.json).
    // annotations are per-placeholder (per distinct secret), so sum counts per rule.
    const rules = [...new Set(manifest.redaction.map((a) => a.ruleId))].sort();
    expect(rules).toEqual(["anthropic-key", "github-token"]);
    const countByRule = new Map<string, number>();
    for (const a of manifest.redaction) countByRule.set(a.ruleId, (countByRule.get(a.ruleId) ?? 0) + a.count);
    // anthropic-key total: SUB_SECRET(1) + SHARED(main 1 + subagent 1) + TR_SECRET(1) = 4
    expect(countByRule.get("anthropic-key")).toBe(4);
    // github-token (META_SECRET, sidecar-only): 1
    expect(countByRule.get("github-token")).toBe(1);

    const dest = path.join(tmp, "f1-out");
    await extract(dest);
    const transcript = readFileSync(path.join(dest, "transcript.jsonl"), "utf8");
    const sub = readFileSync(path.join(dest, "subagents", "agent-f1.jsonl"), "utf8");
    const meta = readFileSync(path.join(dest, "subagents", "agent-f1.meta.json"), "utf8");
    const tr = readFileSync(path.join(dest, "tool-results", "toolu_f1.txt"), "utf8");

    // SHARED gets the SAME placeholder in the main transcript and the subagent file.
    const map = JSON.parse(readFileSync(path.join(home, ".airgap", "maps", "f1.ccpack.json"), "utf8")) as Record<string, string>;
    const sharedPlaceholder = map[SHARED]!;
    expect(sharedPlaceholder).toMatch(/^ANTHROPIC-KEY-REDACTED-[0-9a-f]{6}$/);
    expect(transcript).toContain(sharedPlaceholder);
    expect(sub).toContain(sharedPlaceholder);

    // meta.json secret is redacted; its structure (agentId metadata) is intact
    expect(meta).toContain(map[META_SECRET]!);
    expect(JSON.parse(meta.trim()).agentId).toBe("agent-f1");
    // tool-result text secret redacted
    expect(tr).toContain(map[TR_SECRET]!);
    expect(tr).toContain("more output");
  });
});
