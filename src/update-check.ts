export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 800;
export const UPDATE_CHECK_URL = "https://registry.npmjs.org/airgap/latest";

export interface UpdateCheckEligibility {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  configEnabled: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
  stderrIsTTY: boolean | undefined;
}

const OUTPUT_ONLY_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

export function shouldCheckForUpdate(input: UpdateCheckEligibility): boolean {
  if (input.stdoutIsTTY !== true || input.stderrIsTTY !== true) return false;
  if (input.env.CI !== undefined) return false;
  if (input.env.AIRGAP_NO_UPDATE_CHECK === "1") return false;
  if (input.configEnabled === false) return false;
  if (input.argv.length === 0) return false;
  if (input.argv.includes("--json")) return false;
  if (input.argv.some((arg) => OUTPUT_ONLY_FLAGS.has(arg))) return false;
  return true;
}

function stableVersionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function isNewerStableVersion(latest: string, current: string): boolean {
  const next = stableVersionParts(latest);
  const running = stableVersionParts(current);
  if (!next || !running) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]! > running[index]!) return true;
    if (next[index]! < running[index]!) return false;
  }
  return false;
}
