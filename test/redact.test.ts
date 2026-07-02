import { describe, expect, it } from "vitest";
import { redactRecords } from "../src/redact.js";
import { sha256String } from "../src/util/text.js";
import type { JsonlRecord, RuleMatch } from "../src/types.js";

const SECRET = "sk-ant-aaaabbbbccccddddeeeefff";
const SECRET2 = "ghp_" + "A".repeat(36);

/** contract-shaped fake scanner (scanString signature), no import of A 组 code */
const fakeScan = (s: string): RuleMatch[] => {
  const out: RuleMatch[] = [];
  if (s.includes(SECRET)) {
    out.push({ ruleId: "anthropic-key", severity: "critical", secret: SECRET, preview: "sk-a…efff" });
  }
  if (s.includes(SECRET2)) {
    out.push({ ruleId: "github-token", severity: "critical", secret: SECRET2, preview: "ghp_…AAAA" });
  }
  return out;
};

function rec(lineNo: number, json: Record<string, unknown>): JsonlRecord {
  const raw = JSON.stringify(json);
  return { raw, lineNo, json: JSON.parse(raw) as Record<string, unknown> };
}

function makeRecords(): JsonlRecord[] {
  return [
    rec(1, {
      uuid: "u1",
      parentUuid: null,
      sessionId: "sid-1",
      type: "assistant",
      message: {
        id: "m1",
        content: [
          { type: "thinking", thinking: `the key is ${SECRET} yes ${SECRET}`, signature: SECRET },
          { type: "tool_use", id: SECRET, name: "Bash", input: { command: `echo ${SECRET2}` } },
        ],
      },
    }),
    rec(2, {
      uuid: "u2",
      parentUuid: "u1",
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: SECRET, content: `stdout had ${SECRET}` }] },
      toolUseResult: { stdout: `stdout had ${SECRET}` },
    }),
    rec(3, { uuid: "u3", parentUuid: "u2", type: "user", message: { content: "totally clean" } }),
  ];
}

const PLACEHOLDER = `ANTHROPIC-KEY-REDACTED-${sha256String(SECRET).slice(0, 6)}`;
const PLACEHOLDER2 = `GITHUB-TOKEN-REDACTED-${sha256String(SECRET2).slice(0, 6)}`;

describe("redactRecords", () => {
  it("replaces secrets in string values with the contract placeholder format", () => {
    const result = redactRecords(makeRecords(), fakeScan);
    expect(PLACEHOLDER).toMatch(/^ANTHROPIC-KEY-REDACTED-[0-9a-f]{6}$/);
    const r1 = result.records[0]!;
    const msg = (r1.json as { message: { content: Array<Record<string, unknown>> } }).message;
    expect(msg.content[0]!.thinking).toBe(`the key is ${PLACEHOLDER} yes ${PLACEHOLDER}`);
    expect((msg.content[1]!.input as { command: string }).command).toBe(`echo ${PLACEHOLDER2}`);
    // re-serialized raw reflects the replacement
    expect(r1.raw).toContain(PLACEHOLDER);
    expect(r1.raw).not.toContain(`the key is ${SECRET}`);
  });

  it("same secret maps to the same placeholder everywhere (consistency mapping)", () => {
    const result = redactRecords(makeRecords(), fakeScan);
    const r2 = result.records[1]!;
    const stdout = (r2.json as { toolUseResult: { stdout: string } }).toolUseResult.stdout;
    expect(stdout).toBe(`stdout had ${PLACEHOLDER}`);
    const content = (r2.json as { message: { content: Array<Record<string, unknown>> } }).message.content[0]!;
    expect(content.content).toBe(`stdout had ${PLACEHOLDER}`);
  });

  it("never touches metadata: uuid/parentUuid/tool_use_id/signature/tool_use id survive byte-for-byte", () => {
    const before = makeRecords();
    const result = redactRecords(before, fakeScan);
    const r1 = result.records[0]! .json as {
      uuid: string;
      parentUuid: null;
      sessionId: string;
      message: { id: string; content: Array<Record<string, unknown>> };
    };
    expect(r1.uuid).toBe("u1");
    expect(r1.parentUuid).toBeNull();
    expect(r1.sessionId).toBe("sid-1");
    expect(r1.message.id).toBe("m1");
    expect(r1.message.content[0]!.signature).toBe(SECRET); // metadata key skipped
    expect(r1.message.content[1]!.id).toBe(SECRET); // tool_use block id skipped
    const r2 = result.records[1]!.json as { message: { content: Array<Record<string, unknown>> } };
    expect(r2.message.content[0]!.tool_use_id).toBe(SECRET); // tool_use_id skipped
  });

  it("leaves clean records byte-identical and does not mutate the input", () => {
    const input = makeRecords();
    const rawBefore = input.map((r) => r.raw);
    const result = redactRecords(input, fakeScan);
    expect(result.records[2]!.raw).toBe(rawBefore[2]);
    expect(result.records[2]!.lineNo).toBe(3);
    // inputs untouched
    expect(input[0]!.raw).toBe(rawBefore[0]);
    expect(JSON.stringify(input[0]!.json)).toContain(SECRET);
  });

  it("produces annotations with occurrence counts and a secret->placeholder reverse map", () => {
    const result = redactRecords(makeRecords(), fakeScan);
    const byRule = new Map(result.annotations.map((a) => [a.ruleId, a]));
    // SECRET: 2x in thinking + 1x tool_result content + 1x toolUseResult.stdout = 4
    expect(byRule.get("anthropic-key")).toEqual({
      ruleId: "anthropic-key",
      severity: "critical",
      placeholder: PLACEHOLDER,
      count: 4,
    });
    expect(byRule.get("github-token")?.count).toBe(1);
    expect(result.reverseMap).toEqual({ [SECRET]: PLACEHOLDER, [SECRET2]: PLACEHOLDER2 });
  });

  it("no matches -> zero annotations, empty reverse map", () => {
    const result = redactRecords(makeRecords(), () => []);
    expect(result.annotations).toEqual([]);
    expect(result.reverseMap).toEqual({});
    expect(result.records.map((r) => r.raw)).toEqual(makeRecords().map((r) => r.raw));
  });
});
