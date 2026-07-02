import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Stream a jsonl file line by line without loading it into memory. */
export async function* streamLines(file: string): AsyncGenerator<{ line: string; lineNo: number }> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    if (line.trim().length === 0) continue;
    yield { line, lineNo };
  }
}

export function tryParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read only the first parseable record (cheap metadata peek). */
export async function firstRecord(file: string): Promise<Record<string, unknown> | null> {
  for await (const { line } of streamLines(file)) {
    return tryParse(line);
  }
  return null;
}
