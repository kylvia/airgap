import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PREFILTER, RULES } from "../src/detect/rules.js";
import { scanSessionFile, scanString } from "../src/detect/scanner.js";
import { discoverSessions } from "../src/discovery.js";
import type { SessionInfo, Severity } from "../src/types.js";

const HOME = fileURLToPath(new URL("./fixtures/home", import.meta.url));

function ruleIds(value: string): string[] {
  return scanString(value).map((m) => m.ruleId);
}

describe("RULES table", () => {
  it("contains exactly the 16 contract rules with contract severities", () => {
    const expected: Record<string, Severity> = {
      "anthropic-key": "critical",
      "openai-key": "critical",
      "github-token": "critical",
      "aws-access-key": "critical",
      "aws-secret-key": "high",
      "google-api-key": "critical",
      "slack-token": "critical",
      "stripe-key": "critical",
      "npm-token": "high",
      "telegram-bot": "high",
      "private-key": "critical",
      jwt: "medium",
      "url-credentials": "high",
      "bearer-token": "medium",
      "generic-assignment": "medium",
      "env-dump": "high",
    };
    expect(RULES.map((r) => r.id).sort()).toEqual(Object.keys(expected).sort());
    for (const r of RULES) expect(r.severity, r.id).toBe(expected[r.id]);
  });

  it("PREFILTER passes lines with markers and rejects benign lines", () => {
    expect(PREFILTER.test('{"text":"sk-ant-api03-Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"}')).toBe(true);
    expect(PREFILTER.test("DATABASE_HOST=10.20.30.40")).toBe(true);
    expect(PREFILTER.test('{"type":"user","text":"hello world, all good"}')).toBe(false);
    expect(PREFILTER.test("plain chatter about coffee machines")).toBe(false);
  });
});

describe("scanString rule hits", () => {
  const hits: Array<[string, string]> = [
    ["anthropic-key", "sk-ant-api03-Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"],
    ["openai-key", "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8t"],
    ["openai-key", "sk-Ab3xT3BlbkFJZq8Rf2Kd9L"],
    ["github-token", "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"],
    ["github-token", "github_pat_11ABCDEFGHIJKLMNOPQRSTUV"],
    ["aws-access-key", "AKIAZK9GH3JQ7TPW5XLM"],
    ["aws-secret-key", 'aws_secret_access_key = "wJalrXUtnF3MIK79MDENGbPxRfiCYzQ4LpNv8WkT"'],
    ["google-api-key", "AIzaSyD9k2Lm4Np6Xw1Vt3Yb5Zq8Rf2Kd7Hj0Qw"],
    ["slack-token", "xoxb-1234567890-abcdefghijkl"],
    ["stripe-key", "sk_live_Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"],
    ["stripe-key", "rk_live_Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"],
    ["npm-token", "npm_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"],
    ["telegram-bot", "123456789:AAF5nQ8xL2wY7cV3bR9tK4mJ6pD1sG0hZeX"],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["private-key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["private-key", "-----BEGIN PRIVATE KEY-----"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabc123kj"],
    ["url-credentials", "postgres://admin:hunter22@db.internal:5432/app"],
    ["bearer-token", "Authorization: Bearer Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5Hj7Qw0Ex"],
    ["bearer-token", "authorization: bearer Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5Hj7Qw0Ex"],
    ["generic-assignment", 'api_key = "Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"'],
    ["generic-assignment", "PASSWORD: Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5"],
    ["env-dump", "PATH_X=abc123\nAPI_HOST=10.0.0.1\nDB_NAME=prod"],
    // env dump where the newlines are the two-character literal `\n` (raw jsonl form)
    ["env-dump", "FOO_A=alpha1\\nFOO_B=bravo2\\nFOO_C=charlie3"],
  ];

  it.each(hits)("%s matches %s", (ruleId, input) => {
    expect(ruleIds(input), input).toContain(ruleId);
  });

  it("context rules report only the credential value as the secret", () => {
    const aws = scanString('aws_secret_access_key = "wJalrXUtnF3MIK79MDENGbPxRfiCYzQ4LpNv8WkT"').find(
      (m) => m.ruleId === "aws-secret-key",
    )!;
    expect(aws.secret).toBe("wJalrXUtnF3MIK79MDENGbPxRfiCYzQ4LpNv8WkT");
    const bearer = scanString("Bearer Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5Hj7Qw0Ex").find(
      (m) => m.ruleId === "bearer-token",
    )!;
    expect(bearer.secret).toBe("Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5Hj7Qw0Ex");
  });

  it("env-dump emits one match per env line, only at >=3 lines", () => {
    const matches = scanString("PATH_X=abc123\nAPI_HOST=10.0.0.1\nDB_NAME=prod").filter(
      (m) => m.ruleId === "env-dump",
    );
    expect(matches.map((m) => m.secret)).toEqual(["PATH_X=abc123", "API_HOST=10.0.0.1", "DB_NAME=prod"]);
  });

  it("masks the preview as first4…last4", () => {
    const m = scanString("sk-ant-api03-Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5")[0]!;
    expect(m.preview).toBe("sk-a…3Yb5");
    expect(m.preview).not.toContain("api03");
  });
});

describe("scanString non-hits", () => {
  const misses: string[] = [
    "sk-ant-short",
    "sk-proj-short",
    "sk-noMarkerHere1234567",
    "ghp_tooShort123",
    "AKIA1234",
    "AIzaTooShort",
    "xoxq-1234567890-abcdefghijkl",
    "sk_test_Zq8Rf2Kd9Lm4Np6Xw1Vt3Yb5",
    "npm_short",
    "12345:AAtooShort",
    "-----BEGIN CERTIFICATE-----",
    "eyJab.eyJcd.ef",
    "https://db.internal:5432/app",
    "DB_HOST=localhost\nDB_PORT=5432",
    "plain conversation text about coffee machines",
  ];

  it.each(misses)("no match for %s", (input) => {
    expect(scanString(input)).toEqual([]);
  });

  it("entropy filter drops low-entropy bearer and assignment values", () => {
    expect(scanString("Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toEqual([]);
    expect(scanString("password: hunter2hunter2hunter2")).toEqual([]);
  });

  it("false-positive guards drop placeholder-looking hits", () => {
    expect(scanString("sk-ant-api03-REDACTEDZq8Rf2Kd9Lm4Np6")).toEqual([]);
    expect(scanString("AKIAIOSFODNN7EXAMPLE")).toEqual([]);
    expect(scanString("ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toEqual([]);
    expect(scanString("sk-ant-your-key-here-1234567890abcdef")).toEqual([]);
    expect(scanString('password = "zzzzzzzzzzzzzzzzzzzz"')).toEqual([]);
    // placeholder env line does not count toward the >=3 threshold
    expect(scanString("API_KEY=<put-key-here>\nDB_HOST=localhost\nDB_PORT=5432")).toEqual([]);
  });
});

describe("scanSessionFile", () => {
  async function session(project: string, source: "claude" | "codex" = "claude"): Promise<SessionInfo> {
    const sessions = await discoverSessions({ home: HOME, sources: [source], project });
    expect(sessions.length).toBeGreaterThan(0);
    return sessions[sessions.length - 1]!;
  }

  it("finds and deduplicates secrets across transcript and sidecars", async () => {
    const findings = await scanSessionFile(await session("beta"));
    const by = (id: string) => findings.filter((f) => f.ruleId === id);

    expect(findings).toHaveLength(7);

    const anth = by("anthropic-key");
    expect(anth).toHaveLength(1);
    expect(anth[0]!.count).toBe(2); // line 2 text + line 3 stdout, same secret
    expect(anth[0]!.lineNo).toBe(2);
    expect(anth[0]!.fieldPath).toBe("message.content.0.text");
    expect(anth[0]!.sourceFile.endsWith("33333333-3333-4333-8333-333333333333.jsonl")).toBe(true);
    expect(anth[0]!.sessionId).toBe("33333333-3333-4333-8333-333333333333");
    expect(anth[0]!.project).toBe("/Users/tester/beta");

    const gh = by("github-token");
    expect(gh).toHaveLength(1);
    expect(gh[0]!.count).toBe(1);
    expect(gh[0]!.lineNo).toBe(3);
    expect(gh[0]!.fieldPath).toBe("toolUseResult.stdout");

    const slack = by("slack-token");
    expect(slack).toHaveLength(1);
    expect(slack[0]!.sourceFile).toContain("agent-beta01.jsonl");

    const env = by("env-dump");
    expect(env).toHaveLength(3);
    expect(env.every((f) => f.sourceFile.endsWith("toolu_01BETA.txt"))).toBe(true);
    expect(env.map((f) => f.lineNo)).toEqual([2, 3, 4]);

    const url = by("url-credentials");
    expect(url).toHaveLength(1);
    expect(url[0]!.lineNo).toBe(5);
  });

  it("never scans metadata fields like thinking signatures", async () => {
    const findings = await scanSessionFile(await session("beta"));
    expect(findings.some((f) => f.secret.includes("SigOnlyVal"))).toBe(false);
  });

  it("returns no findings for clean sessions (incl. their sidecars)", async () => {
    const sessions = await discoverSessions({ home: HOME, sources: ["claude"], project: "alpha" });
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(await scanSessionFile(s)).toEqual([]);
    }
  });

  it("scans codex rollout files", async () => {
    const findings = await scanSessionFile(await session("alpha", "codex"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("anthropic-key");
    expect(findings[0]!.source).toBe("codex");
    expect(findings[0]!.lineNo).toBe(2);
  });
});
