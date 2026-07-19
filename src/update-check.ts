import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { I18n } from "./i18n/index.js";

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

export interface UpdateCheckOptions extends UpdateCheckEligibility {
  currentVersion: string;
  i18n: I18n;
  home?: string;
  now?: () => number;
  timeoutMs?: number;
  requestLatest?: (signal: AbortSignal) => Promise<unknown>;
  writeStderr?: (message: string) => void;
}

interface UpdateCheckCache {
  checkedAt: string;
  latestVersion?: string;
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

function cachePath(home: string): string {
  return path.join(home, ".airgap", "update-check.json");
}

async function readCache(home: string): Promise<UpdateCheckCache | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(home), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record["checkedAt"] !== "string") return null;
    return {
      checkedAt: record["checkedAt"],
      ...(typeof record["latestVersion"] === "string"
        ? { latestVersion: record["latestVersion"] }
        : {}),
    };
  } catch {
    return null;
  }
}

async function writeCache(home: string, cache: UpdateCheckCache): Promise<void> {
  const dir = path.join(home, ".airgap");
  const file = cachePath(home);
  const temporaryFile = path.join(
    dir,
    `.update-check.json.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temporaryFile, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}

function latestVersionFrom(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const version = (payload as Record<string, unknown>)["version"];
  return typeof version === "string" && stableVersionParts(version) ? version : undefined;
}

async function fetchLatestVersion(signal: AbortSignal, currentVersion: string): Promise<unknown> {
  const response = await fetch(UPDATE_CHECK_URL, {
    signal,
    headers: {
      accept: "application/json",
      "user-agent": `airgap/${currentVersion} update-check`,
    },
  });
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
  return response.json();
}

export async function checkForUpdate(options: UpdateCheckOptions): Promise<void> {
  if (!shouldCheckForUpdate(options)) return;

  const home = options.home ?? os.homedir();
  const now = options.now?.() ?? Date.now();
  const cache = await readCache(home);
  const checkedAt = cache ? Date.parse(cache.checkedAt) : Number.NaN;
  if (
    Number.isFinite(checkedAt) &&
    checkedAt <= now &&
    now - checkedAt < UPDATE_CHECK_INTERVAL_MS
  ) {
    return;
  }

  const controller = new AbortController();
  const request = options.requestLatest ??
    ((signal: AbortSignal) => fetchLatestVersion(signal, options.currentVersion));
  let timeout: NodeJS.Timeout | undefined;
  let latestVersion: string | undefined;
  try {
    const payload = await Promise.race([
      request(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("update check timed out"));
        }, options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS);
      }),
    ]);
    latestVersion = latestVersionFrom(payload);
  } catch {
    latestVersion = undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const nextCache: UpdateCheckCache = {
    checkedAt: new Date(now).toISOString(),
    ...(latestVersion ? { latestVersion } : {}),
  };
  await writeCache(home, nextCache).catch(() => undefined);

  if (!latestVersion || !isNewerStableVersion(latestVersion, options.currentVersion)) return;
  const message = options.i18n.t("update.available", {
    latest: latestVersion,
    current: options.currentVersion,
  });
  try {
    (options.writeStderr ?? ((text: string) => process.stderr.write(text)))(`${message}\n`);
  } catch {
    // An informational update notice must never fail the requested command.
  }
}
