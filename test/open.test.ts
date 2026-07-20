import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import * as yazl from "yazl";
import { afterAll, describe, expect, it } from "vitest";
import { runOpen } from "../src/commands/open.js";
import { sanitizeForTerminal } from "../src/util/terminal.js";
import type { PackManifest } from "../src/types.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "airgap-open-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha256 = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

interface PackSpec {
  transcript: string;
  sidecars?: Array<{ path: string; content: string; role: "subagent" | "tool-result" | "meta" }>;
  manifest?: Partial<PackManifest>;
}

/** Build a raw .ccpack zip with a hand-controlled manifest (honest sha256s). */
async function buildRawPack(outFile: string, spec: PackSpec): Promise<void> {
  const files: Array<{ zipPath: string; content: string; role: PackManifest["entries"][number]["role"] }> = [
    { zipPath: "transcript.jsonl", content: spec.transcript, role: "transcript" },
    ...(spec.sidecars ?? []).map((s) => ({ zipPath: s.path, content: s.content, role: s.role })),
  ];
  const entries: PackManifest["entries"] = files.map((f) => ({
    path: f.zipPath,
    sha256: sha256(f.content),
    role: f.role,
  }));

  const manifest: PackManifest = {
    specVersion: 1,
    producer: "airgap/0.0.0",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: { tool: "claude", toolVersion: "2.1.198", dialect: "claude-jsonl-tree/1" },
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    pathTokens: { "{{PROJECT_ROOT}}": "/orig/proj", "{{HOME}}": "/orig/home" },
    entries,
    redaction: [],
    slice: {
      totalRecords: 1,
      keptRecords: 1,
      droppedTypes: {},
      toolUsePairs: 0,
      subagentFiles: 0,
      toolResultFiles: 0,
      closureComplete: true,
    },
    ...spec.manifest,
  };
  // if caller overrode entries via manifest, honor theirs; else use computed
  if (!spec.manifest?.entries) manifest.entries = entries;

  const zip = new yazl.ZipFile();
  for (const f of files) zip.addBuffer(Buffer.from(f.content, "utf8"), f.zipPath);
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), "manifest.json");
  zip.end();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (c) => chunks.push(c as Buffer));
    zip.outputStream.on("end", () => resolve());
    zip.outputStream.on("error", reject);
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, Buffer.concat(chunks));
}

const okTranscript =
  JSON.stringify({
    type: "user",
    uuid: "u1",
    parentUuid: null,
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cwd: "{{PROJECT_ROOT}}",
    message: { role: "user", content: "hello, see {{PROJECT_ROOT}}/a.txt and {{HOME}}/notes.txt" },
  }) + "\n";

// ---------- F6: terminal sanitization ----------

describe("F6 sanitizeForTerminal", () => {
  it("strips OSC 52 clipboard payloads and CSI/ESC sequences", () => {
    const osc52 = "\x1b]52;c;bWFsaWNpb3Vz\x07";
    const clear = "\x1b[2J";
    const s = `title${osc52}${clear}\x1b[31mred\x1b[0m`;
    const out = sanitizeForTerminal(s);
    // ESC is removed, so no sequence is active. OSC payloads are consumed whole.
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("]52");
    expect(out).not.toContain("bWFsaWNpb3Vz"); // OSC 52 payload gone entirely
    // CSI parameter bytes survive as inert plain text (no ESC to arm them).
    expect(out).toBe("title[2J[31mred[0m");
  });

  it("strips bare control chars including CR/BEL/backspace used to overwrite lines", () => {
    expect(sanitizeForTerminal("a\rFAKE")).toBe("aFAKE");
    expect(sanitizeForTerminal("a\x08\x08b")).toBe("ab");
    expect(sanitizeForTerminal("a\x9bBc")).toBe("aBc"); // C1 CSI
  });

  it("printReceipt output for a booby-trapped manifest is fully sanitized", async () => {
    const out = path.join(tmp, "trap.ccpack");
    await buildRawPack(out, {
      transcript: okTranscript,
      manifest: {
        title: "clear\x1b[2Jscreen\x1b]52;c;cA==\x07",
        producer: "airgap/\x1b[1mFAKE\x1b[32mGREEN",
        source: { tool: "claude", toolVersion: "\x1b[2J", dialect: "claude-jsonl-tree/1" },
        redaction: [
          { ruleId: "evil\x1b[2J", severity: "critical" as const, placeholder: "\x1b]52;c;x\x07", count: 1 },
        ],
      },
    });
    const logs: string[] = [];
    // print-only so we exercise the receipt without installing
    await runOpen(out, { printOnly: true }, { tmpdir: tmp, log: (l) => logs.push(l) });
    const joined = logs.join("\n");
    // Only these complete, static lines are allowed to carry Airgap's own SGR
    // formatting. Every line that can include manifest data must remain ESC-free,
    // even when an attacker injects the same bold/green codes Airgap itself uses.
    const trustedStyledLines = new Set([
      pc.bold("── 信任回执 ────────────────────────────"),
      `  闭包       ${pc.green("完整")}`,
      pc.bold("────────────────────────────────────────"),
    ]);
    for (const line of logs) {
      if (!trustedStyledLines.has(line)) expect(line).not.toContain("\x1b");
    }
    expect(joined).toContain("airgap/[1mFAKE[32mGREEN");
    // OSC 52 payload bodies are consumed entirely.
    expect(joined).not.toContain("cA==");
    expect(joined).not.toMatch(/]52;/);
  });
});

// ---------- F7: re-scan before install ----------

describe("F7 open re-scans and refuses residual plaintext", () => {
  const secret = "sk-ant-AAAABBBBCCCCDDDDEEEEFFFFGGGG";

  it("default-refuses a pack whose manifest claims clean but still ships a plaintext key", async () => {
    const out = path.join(tmp, "residual.ccpack");
    const leaky =
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cwd: "{{PROJECT_ROOT}}",
        message: { role: "user", content: `key is ${secret}` },
      }) + "\n";
    await buildRawPack(out, { transcript: leaky, manifest: { redaction: [] } });

    await expect(
      runOpen(out, { project: path.join(tmp, "t-residual") }, { home: path.join(tmp, "h-residual"), tmpdir: tmp, interactive: false, log: () => {} }),
    ).rejects.toThrow(/accept-risk|明文/);
    // nothing installed
    expect(existsSync(path.join(tmp, "h-residual", ".claude"))).toBe(false);
  });

  it("--accept-risk lets the leaky pack through", async () => {
    const out = path.join(tmp, "residual2.ccpack");
    const leaky =
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cwd: "{{PROJECT_ROOT}}",
        message: { role: "user", content: `key is ${secret}` },
      }) + "\n";
    await buildRawPack(out, { transcript: leaky });

    const home = path.join(tmp, "h-accept");
    const res = await runOpen(
      out,
      { project: path.join(tmp, "t-accept"), acceptRisk: true },
      { home, tmpdir: tmp, interactive: false, log: () => {} },
    );
    expect(res.newSessionId).toBeDefined();
    expect(existsSync(res.installedPath!)).toBe(true);
  });

  it("a genuinely clean pack installs without --accept-risk", async () => {
    const out = path.join(tmp, "clean.ccpack");
    await buildRawPack(out, { transcript: okTranscript });
    const home = path.join(tmp, "h-clean");
    const res = await runOpen(
      out,
      { project: path.join(tmp, "t-clean") },
      { home, tmpdir: tmp, interactive: false, log: () => {} },
    );
    expect(res.newSessionId).toBeDefined();
    expect(existsSync(res.installedPath!)).toBe(true);
  });
});

// ---------- F8: literal token not mis-restored ----------

describe("F8 restoreTokens honors manifest.pathTokens", () => {
  it("does not restore a literal {{HOME}} the pack never tokenized", async () => {
    const out = path.join(tmp, "literal.ccpack");
    // manifest declares ONLY {{PROJECT_ROOT}}; content has a literal {{HOME}}
    const transcript =
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cwd: "{{PROJECT_ROOT}}",
        message: { role: "user", content: "docs say use the {{HOME}} placeholder; real path {{PROJECT_ROOT}}/x" },
      }) + "\n";
    await buildRawPack(out, {
      transcript,
      manifest: { pathTokens: { "{{PROJECT_ROOT}}": "/orig/proj" } },
    });

    const home = path.join(tmp, "h-literal");
    const proj = path.join(tmp, "t-literal");
    const res = await runOpen(out, { project: proj }, { home, tmpdir: tmp, interactive: false, log: () => {} });
    const installed = readFileSync(res.installedPath!, "utf8");
    const rec = JSON.parse(installed.trim()) as { message: { content: string } };
    // {{HOME}} stays literal (not declared), {{PROJECT_ROOT}} restored to target
    expect(rec.message.content).toContain("the {{HOME}} placeholder");
    expect(rec.message.content).toContain(`${proj}/x`);
    expect(rec.message.content).not.toContain(home); // home never injected
  });

  it("restores {{HOME}} when the pack did declare it, single-pass (no double substitution)", async () => {
    const out = path.join(tmp, "declared.ccpack");
    const res0Home = path.join(tmp, "h-declared");
    const transcript =
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cwd: "{{PROJECT_ROOT}}",
        message: { role: "user", content: "notes at {{HOME}}/notes.txt" },
      }) + "\n";
    await buildRawPack(out, {
      transcript,
      manifest: { pathTokens: { "{{PROJECT_ROOT}}": "/orig/proj", "{{HOME}}": "/orig/home" } },
    });
    const res = await runOpen(out, { project: path.join(tmp, "t-declared") }, { home: res0Home, tmpdir: tmp, interactive: false, log: () => {} });
    const rec = JSON.parse(readFileSync(res.installedPath!, "utf8").trim()) as { message: { content: string } };
    expect(rec.message.content).toBe(`notes at ${res0Home}/notes.txt`);
  });
});

// ---------- F9: stage cleanup ----------

describe("F9 stage temp dir cleanup", () => {
  it("install removes the extraction temp dir and does not return it", async () => {
    const out = path.join(tmp, "cleanup.ccpack");
    await buildRawPack(out, { transcript: okTranscript });
    const stageRoot = mkdtempSync(path.join(tmp, "stage-root-"));
    const res = await runOpen(
      out,
      { project: path.join(tmp, "t-cleanup") },
      { home: path.join(tmp, "h-cleanup"), tmpdir: stageRoot, interactive: false, log: () => {} },
    );
    expect(res.extractedDir).toBeUndefined();
    // no airgap-open-* left behind under the tmpdir we handed in
    const leftovers = readdirSync(stageRoot).filter((n) => n.startsWith("airgap-open-"));
    expect(leftovers).toEqual([]);
  });

  it("print-only keeps the stage and returns it", async () => {
    const out = path.join(tmp, "keepstage.ccpack");
    await buildRawPack(out, { transcript: okTranscript });
    const res = await runOpen(out, { printOnly: true }, { tmpdir: tmp, log: () => {} });
    expect(res.extractedDir).toBeDefined();
    expect(existsSync(path.join(res.extractedDir!, "transcript.jsonl"))).toBe(true);
  });

  it("cleans the stage even when install fails (leaky pack, no --accept-risk)", async () => {
    const out = path.join(tmp, "cleanup-fail.ccpack");
    const secret = "sk-ant-ZZZZYYYYXXXXWWWWVVVVUUUUTTTT";
    const leaky =
      JSON.stringify({ type: "user", uuid: "u1", parentUuid: null, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "{{PROJECT_ROOT}}", message: { role: "user", content: secret } }) + "\n";
    await buildRawPack(out, { transcript: leaky });
    const stageRoot = mkdtempSync(path.join(tmp, "stage-fail-"));
    await expect(
      runOpen(out, { project: path.join(tmp, "t-cf") }, { home: path.join(tmp, "h-cf"), tmpdir: stageRoot, interactive: false, log: () => {} }),
    ).rejects.toThrow();
    expect(readdirSync(stageRoot).filter((n) => n.startsWith("airgap-open-"))).toEqual([]);
  });
});

// ---------- F11: codex packs rejected ----------

describe("F11 codex packs are not installed into ~/.claude", () => {
  it("rejects a codex-source pack before any write", async () => {
    const out = path.join(tmp, "codex.ccpack");
    await buildRawPack(out, {
      transcript: okTranscript,
      manifest: { source: { tool: "codex", toolVersion: "0.99.0", dialect: "codex-rollout/1" } },
    });
    const home = path.join(tmp, "h-codex");
    await expect(
      runOpen(out, { project: path.join(tmp, "t-codex") }, { home, tmpdir: tmp, interactive: false, log: () => {} }),
    ).rejects.toThrow(/codex|非 claude/);
    expect(existsSync(path.join(home, ".claude"))).toBe(false);
  });

  it("rejects a pack whose dialect is not claude-jsonl-tree/* even if tool says claude", async () => {
    const out = path.join(tmp, "weird-dialect.ccpack");
    await buildRawPack(out, {
      transcript: okTranscript,
      manifest: { source: { tool: "claude", toolVersion: "x", dialect: "codex-rollout/1" } },
    });
    await expect(
      runOpen(out, { project: path.join(tmp, "t-wd") }, { home: path.join(tmp, "h-wd"), tmpdir: tmp, interactive: false, log: () => {} }),
    ).rejects.toThrow();
  });

  it("--print-only still unpacks a codex pack for inspection", async () => {
    const out = path.join(tmp, "codex-print.ccpack");
    await buildRawPack(out, {
      transcript: okTranscript,
      manifest: { source: { tool: "codex", toolVersion: "0.99.0", dialect: "codex-rollout/1" } },
    });
    const res = await runOpen(out, { printOnly: true }, { tmpdir: tmp, log: () => {} });
    expect(res.extractedDir).toBeDefined();
    expect(existsSync(path.join(res.extractedDir!, "transcript.jsonl"))).toBe(true);
  });
});
