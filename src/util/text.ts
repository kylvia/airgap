import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function maskSecret(secret: string): string {
  if (secret.length <= 10) return secret.slice(0, 2) + "…";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function sha256String(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Walk every string value in a JSON tree. `visit` may return a replacement
 * string to mutate the tree in place (used by redaction), or undefined to
 * leave the value untouched. Keys in `skipKeys` are never visited or descended
 * into when their value is a string (metadata like uuids/signatures).
 */
export function walkStrings(
  node: unknown,
  skipKeys: ReadonlySet<string>,
  visit: (value: string, path: string[]) => string | undefined,
  path: string[] = [],
): void {
  if (typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") {
        const r = visit(v, [...path, String(i)]);
        if (r !== undefined) node[i] = r;
      } else {
        walkStrings(v, skipKeys, visit, [...path, String(i)]);
      }
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (skipKeys.has(key)) continue;
    const v = obj[key];
    if (typeof v === "string") {
      const r = visit(v, [...path, key]);
      if (r !== undefined) obj[key] = r;
    } else {
      walkStrings(v, skipKeys, visit, [...path, key]);
    }
  }
}

/** Metadata keys that must never be scanned or mutated. */
export const METADATA_KEYS: ReadonlySet<string> = new Set([
  "uuid",
  "parentUuid",
  "sessionId",
  "requestId",
  "id",
  "tool_use_id",
  "toolUseID",
  "signature",
  "leafUuid",
  "sourceToolAssistantUUID",
  "promptId",
  "agentId",
  "timestamp",
  "version",
  "model",
  "gitBranch",
  "sha256",
  "checksum",
]);
