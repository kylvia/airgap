import type { Finding, RuleMatch, SessionInfo } from "../types.js";
import { streamLines, tryParse } from "../util/jsonl.js";
import { maskSecret, METADATA_KEYS, shannonEntropy, walkStrings } from "../util/text.js";
import { PREFILTER, RULES } from "./rules.js";

const ENV_RULE = RULES.find((r) => r.id === "env-dump")!;

/** Rules whose matched value must additionally exceed the entropy floor. */
const ENTROPY_RULES: ReadonlySet<string> = new Set(["bearer-token", "generic-assignment"]);
const ENTROPY_MIN = 3.5;

/** False-positive guard markers (CONTRACTS.md): placeholder-looking hits are dropped. */
const FP_MARKERS = ["REDACTED", "EXAMPLE", "example", "your-", "xxxx", "****", "<"] as const;

function isFalsePositive(secret: string): boolean {
  for (const marker of FP_MARKERS) {
    if (secret.includes(marker)) return true;
  }
  // entirely one repeated character
  return /^(.)\1+$/.test(secret);
}

/** One env-looking line: VAR_NAME=value (per CONTRACTS.md env-dump rule). */
const ENV_LINE = /^[A-Z][A-Z0-9_]{2,}=\S+/;
/** Cheap gate before splitting a value into lines. */
const ENV_HINT = /[A-Z][A-Z0-9_]{2,}=\S/;
/** Newlines inside a scanned value may be real or the two-character literal `\n`. */
const LINE_SPLIT = /\r?\n|\\n/;

/** Extract env-dump matches: >=3 plausible env lines within a single string value. */
function envDumpMatches(value: string): RuleMatch[] {
  if (!ENV_HINT.test(value)) return [];
  const hits: string[] = [];
  for (const part of value.split(LINE_SPLIT)) {
    const m = ENV_LINE.exec(part);
    if (m && !isFalsePositive(m[0])) hits.push(m[0]);
  }
  if (hits.length < 3) return [];
  return hits.map((secret) => ({
    ruleId: ENV_RULE.id,
    severity: ENV_RULE.severity,
    secret,
    preview: maskSecret(secret),
  }));
}

/**
 * Scan a single string value against every rule. Pure function (reused by M2 redact).
 * Entropy floor and false-positive guards are applied here so every consumer gets them.
 */
export function scanString(value: string): RuleMatch[] {
  // A value that fails the merged prefilter cannot match any rule.
  if (!PREFILTER.test(value)) return [];
  const out: RuleMatch[] = [];
  for (const rule of RULES) {
    if (rule.prefilter && !value.includes(rule.prefilter)) continue;
    if (rule.id === "env-dump") {
      out.push(...envDumpMatches(value));
      continue;
    }
    for (const m of value.matchAll(rule.pattern)) {
      const secret = m[1] ?? m[0];
      if (isFalsePositive(secret)) continue;
      if (ENTROPY_RULES.has(rule.id) && shannonEntropy(secret) <= ENTROPY_MIN) continue;
      out.push({ ruleId: rule.id, severity: rule.severity, secret, preview: maskSecret(secret) });
    }
  }
  return out;
}

/**
 * Scan one session (main transcript + subagent jsonl sidecars + tool-result text
 * sidecars) for secrets. Streaming: raw lines are screened with PREFILTER before
 * JSON.parse; parsed records are walked with walkStrings so metadata keys
 * (uuids, signatures, ...) are never scanned. Findings are deduplicated per
 * (ruleId, secret) within the session, with `count` accumulating occurrences.
 */
export async function scanSessionFile(info: SessionInfo): Promise<Finding[]> {
  const byKey = new Map<string, Finding>();

  const add = (m: RuleMatch, sourceFile: string, lineNo: number, fieldPath?: string): void => {
    const key = `${m.ruleId}\u0000${m.secret}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    byKey.set(key, {
      ruleId: m.ruleId,
      severity: m.severity,
      secret: m.secret,
      preview: m.preview,
      sourceFile,
      sessionId: info.id,
      source: info.source,
      project: info.project,
      lineNo,
      fieldPath,
      count: 1,
    });
  };

  const scanJsonlFile = async (file: string): Promise<void> => {
    for await (const { line, lineNo } of streamLines(file)) {
      if (!PREFILTER.test(line)) continue;
      const json = tryParse(line);
      if (json === null) {
        // Not JSON — scan the raw line so nothing slips through.
        for (const m of scanString(line)) add(m, file, lineNo);
        continue;
      }
      walkStrings(json, METADATA_KEYS, (value, path) => {
        for (const m of scanString(value)) add(m, file, lineNo, path.join("."));
        return undefined;
      });
    }
  };

  const scanTextFile = async (file: string): Promise<void> => {
    // env-dump needs cross-line counting: a tool-result file is one logical blob.
    const envHits: Array<{ secret: string; lineNo: number }> = [];
    for await (const { line, lineNo } of streamLines(file)) {
      for (const part of line.split(LINE_SPLIT)) {
        const em = ENV_LINE.exec(part);
        if (em && !isFalsePositive(em[0])) envHits.push({ secret: em[0], lineNo });
      }
      if (!PREFILTER.test(line)) continue;
      for (const m of scanString(line)) {
        if (m.ruleId === "env-dump") continue; // handled at file level below
        add(m, file, lineNo);
      }
    }
    if (envHits.length >= 3) {
      for (const hit of envHits) {
        add(
          {
            ruleId: ENV_RULE.id,
            severity: ENV_RULE.severity,
            secret: hit.secret,
            preview: maskSecret(hit.secret),
          },
          file,
          hit.lineNo,
        );
      }
    }
  };

  await scanJsonlFile(info.file);
  for (const f of info.sidecars.subagents) await scanJsonlFile(f);
  for (const f of info.sidecars.toolResults) await scanTextFile(f);

  return [...byKey.values()];
}
