import { METADATA_KEYS, sha256String, walkStrings } from "./util/text.js";
import type { JsonlRecord, RedactResult, RedactionAnnotation, RuleMatch } from "./types.js";

/**
 * Replace every detected secret with a stable placeholder:
 *   <RULE-ID uppercased>-REDACTED-<first 6 hex of sha256(secret)>
 * The same secret always maps to the same placeholder (consistency mapping).
 * Only string *values* are touched, via walkStrings with METADATA_KEYS skipped,
 * so uuid/parentUuid/tool_use_id/signature/... are never modified.
 * Input records are not mutated; changed records get their raw re-serialized.
 *
 * The scanner is injected so this module has no dependency on the detect stack
 * (tests use a fake; the pack command injects the real scanString).
 */
export function redactRecords(records: JsonlRecord[], scan: (s: string) => RuleMatch[]): RedactResult {
  const placeholderBySecret = new Map<string, string>();
  const annByPlaceholder = new Map<string, RedactionAnnotation>();

  const out: JsonlRecord[] = records.map((rec) => {
    if (!rec.json) return { ...rec };
    const clone = JSON.parse(rec.raw) as Record<string, unknown>;
    let mutated = false;

    walkStrings(clone, METADATA_KEYS, (value) => {
      const matches = scan(value);
      if (matches.length === 0) return undefined;
      let next = value;
      for (const m of matches) {
        if (!m.secret) continue;
        const occurrences = next.split(m.secret).length - 1;
        if (occurrences === 0) continue;

        let placeholder = placeholderBySecret.get(m.secret);
        if (placeholder === undefined) {
          placeholder = `${m.ruleId.toUpperCase()}-REDACTED-${sha256String(m.secret).slice(0, 6)}`;
          placeholderBySecret.set(m.secret, placeholder);
        }
        let ann = annByPlaceholder.get(placeholder);
        if (!ann) {
          ann = { ruleId: m.ruleId, severity: m.severity, placeholder, count: 0 };
          annByPlaceholder.set(placeholder, ann);
        }

        next = next.split(m.secret).join(placeholder);
        ann.count += occurrences;
      }
      if (next === value) return undefined;
      mutated = true;
      return next;
    });

    if (!mutated) return { ...rec };
    return { raw: JSON.stringify(clone), lineNo: rec.lineNo, json: clone };
  });

  const reverseMap: Record<string, string> = {};
  for (const [secret, placeholder] of placeholderBySecret) reverseMap[secret] = placeholder;

  return { records: out, annotations: [...annByPlaceholder.values()], reverseMap };
}
