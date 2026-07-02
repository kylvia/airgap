import { randomBytes } from "node:crypto";
import { METADATA_KEYS, walkStrings } from "./util/text.js";
import type { JsonlRecord, RedactResult, RedactionAnnotation, RuleMatch } from "./types.js";

type Scanner = (s: string) => RuleMatch[];

/**
 * A per-pack redactor sharing one consistency mapping across the main transcript
 * and every sidecar (subagents / meta / tool-results).
 *
 * - `redactRecords(records)` redacts JsonlRecord arrays (walkStrings + METADATA_KEYS),
 *   re-serializing changed records' `raw`.
 * - `redactText(text)` redacts a plain-text blob (tool-results/*.txt) whole.
 * - `result()` returns { annotations, reverseMap }.
 *
 * The same secret always maps to the same placeholder, in *any* file, because the
 * mapping lives on the redactor instance. Placeholders are per-pack random tokens
 * (F5): they leak zero information about the secret and are unlinkable across packs,
 * but stay consistent within one pack.
 *
 * Defense in depth (F3): after rewriting any string, we re-scan the result; if a
 * secret survives (e.g. a containment overlap left a tail), we fail closed and throw
 * rather than emit a pack that still leaks. A security tool must refuse, not leak.
 *
 * The scanner is injected so this module has no dependency on the detect stack.
 */
export interface Redactor {
  redactRecords(records: JsonlRecord[]): JsonlRecord[];
  redactText(text: string): string;
  result(): { annotations: RedactionAnnotation[]; reverseMap: Record<string, string> };
}

export function createRedactor(scan: Scanner): Redactor {
  const placeholderBySecret = new Map<string, string>();
  const annByPlaceholder = new Map<string, RedactionAnnotation>();

  const placeholderFor = (m: RuleMatch): string => {
    let placeholder = placeholderBySecret.get(m.secret);
    if (placeholder === undefined) {
      // per-pack random token, secret-independent (F5): no info leak, no cross-pack link.
      placeholder = `${m.ruleId.toUpperCase()}-REDACTED-${randomBytes(4).toString("hex").slice(0, 6)}`;
      placeholderBySecret.set(m.secret, placeholder);
    }
    return placeholder;
  };

  const bumpAnnotation = (m: RuleMatch, placeholder: string, by: number): void => {
    let ann = annByPlaceholder.get(placeholder);
    if (!ann) {
      ann = { ruleId: m.ruleId, severity: m.severity, placeholder, count: 0 };
      annByPlaceholder.set(placeholder, ann);
    }
    ann.count += by;
  };

  /** Redact one string; returns the rewritten string (or the original if untouched). */
  const redactValue = (value: string): string => {
    const matches = scan(value);
    if (matches.length === 0) return value;
    // F3: replace longest secrets first so a short secret that is a substring of a
    // longer one can't consume the longer one's occurrences and leave a tail behind.
    const ordered = [...matches].sort((a, b) => b.secret.length - a.secret.length);
    let next = value;
    for (const m of ordered) {
      if (!m.secret) continue;
      const occurrences = next.split(m.secret).length - 1;
      if (occurrences === 0) continue;
      const placeholder = placeholderFor(m);
      next = next.split(m.secret).join(placeholder);
      bumpAnnotation(m, placeholder, occurrences);
    }
    if (next !== value) {
      // F3 defense in depth: refuse to emit anything that still scans dirty.
      const residual = scan(next);
      if (residual.length > 0) {
        throw new Error(
          `redaction fail-closed: secret still present after redaction (ruleId=${residual[0]!.ruleId}); refusing to write pack`,
        );
      }
    }
    return next;
  };

  const redactRecords = (records: JsonlRecord[]): JsonlRecord[] =>
    records.map((rec) => {
      if (!rec.json) return { ...rec };
      const clone = JSON.parse(rec.raw) as Record<string, unknown>;
      let mutated = false;
      walkStrings(clone, METADATA_KEYS, (value) => {
        const next = redactValue(value);
        if (next === value) return undefined;
        mutated = true;
        return next;
      });
      if (!mutated) return { ...rec };
      return { raw: JSON.stringify(clone), lineNo: rec.lineNo, json: clone };
    });

  const redactText = (text: string): string => redactValue(text);

  const result = (): { annotations: RedactionAnnotation[]; reverseMap: Record<string, string> } => {
    const reverseMap: Record<string, string> = {};
    for (const [secret, placeholder] of placeholderBySecret) reverseMap[secret] = placeholder;
    return { annotations: [...annByPlaceholder.values()], reverseMap };
  };

  return { redactRecords, redactText, result };
}

/**
 * Back-compat single-shot API: redact one record array with a fresh redactor.
 * Kept so existing callers/tests that only touch the main transcript keep working.
 */
export function redactRecords(records: JsonlRecord[], scan: Scanner): RedactResult {
  const redactor = createRedactor(scan);
  const out = redactor.redactRecords(records);
  const { annotations, reverseMap } = redactor.result();
  return { records: out, annotations, reverseMap };
}
