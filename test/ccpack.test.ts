import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yazl from "yazl";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertSafeEntryPath, readPack, writePack } from "../src/ccpack.js";
import { runOpen } from "../src/commands/open.js";
import { runPack } from "../src/commands/pack.js";
import { redactRecords } from "../src/redact.js";
import { sliceSession } from "../src/slice.js";
import { sha256String } from "../src/util/text.js";
import type { RuleMatch, SessionInfo } from "../src/types.js";
import { FIXTURE_CWD, SECRET, SID, writeFixtureSession } from "./fixtures/claude-session.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "airgap-ccpack-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const info: SessionInfo = writeFixtureSession(path.join(tmp, "home"));
const PLACEHOLDER = `TEST-KEY-REDACTED-${sha256String(SECRET).slice(0, 6)}`;

/** contract-shaped scanner mock (scanString signature) — no A 组 import */
const fakeScan = vi.fn((s: string): RuleMatch[] =>
  s.includes(SECRET) ? [{ ruleId: "test-key", severity: "critical", secret: SECRET, preview: "sk-t…1234" }] : [],
);

async function buildPack(outFile: string) {
  const sliced = await sliceSession(info, {});
  const redact = redactRecords(sliced.records, fakeScan);
  const manifest = await writePack(outFile, sliced, redact, { toolVersion: "2.1.198" });
  return { sliced, redact, manifest };
}

describe("writePack -> readPack roundtrip", () => {
  it("produces a manifest matching the contract shape", async () => {
    const out = path.join(tmp, "roundtrip.ccpack");
    const { manifest } = await buildPack(out);

    expect(manifest.specVersion).toBe(1);
    expect(manifest.producer).toMatch(/^airgap\//);
    expect(manifest.sessionId).toBe(SID);
    expect(manifest.title).toBe("Demo session title");
    expect(manifest.source).toEqual({ tool: "claude", toolVersion: "2.1.198", dialect: "claude-jsonl-tree/1" });
    expect(manifest.pathTokens).toEqual({ "{{PROJECT_ROOT}}": FIXTURE_CWD, "{{HOME}}": os.homedir() });
    expect(manifest.redaction).toEqual([
      { ruleId: "test-key", severity: "critical", placeholder: PLACEHOLDER, count: 1 },
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
    const { manifest } = await buildPack(out);
    const { extract } = await readPack(out);
    const dest = path.join(tmp, "extracted");
    await extract(dest);

    const transcript = readFileSync(path.join(dest, "transcript.jsonl"), "utf8");
    expect(transcript).toContain("cat {{PROJECT_ROOT}}/a.txt");
    expect(transcript).toContain("{{HOME}}/notes.txt");
    expect(transcript).not.toContain(FIXTURE_CWD);
    expect(transcript).not.toContain(os.homedir());
    expect(transcript).not.toContain(SECRET);
    expect(transcript).toContain(PLACEHOLDER);
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
    expect(JSON.parse(readFileSync(mapFile, "utf8"))).toEqual({ [SECRET]: PLACEHOLDER });
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
