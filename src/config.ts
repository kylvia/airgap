import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolDisplay } from "./types.js";
import { DEFAULT_TOOL_DISPLAY, TOOL_DISPLAYS } from "./types.js";
import { LANGUAGE_PREFERENCES, type LanguagePreference } from "./i18n/index.js";

/**
 * ~/.airgap/config.json 的已知键。所有键可缺省，未知键忽略；
 * 文件缺失 / JSON 损坏 / 字段非法一律静默回退默认——配置永远不能让命令挂掉。
 */
export interface AirgapConfig {
  /** Raw preference; the centralized locale resolver owns normalization and fallback. */
  language?: string;
  share?: {
    /** share 会话下拉最多列多少个（常用 10 / 20 / 50）；整数，clamp 到 [1, 200] */
    sessionListLimit?: number;
    /** share 预览/导出的工具展示档（none | summary | full） */
    toolDisplay?: ToolDisplay;
  };
}

export const DEFAULT_SESSION_LIST_LIMIT = 20;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function clampLimit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return Math.min(200, Math.max(1, v));
}

function asToolDisplay(v: unknown): ToolDisplay | undefined {
  return typeof v === "string" && (TOOL_DISPLAYS as readonly string[]).includes(v) ? (v as ToolDisplay) : undefined;
}

/** 读 ~/.airgap/config.json（home 可注入便于测试）；任何异常都返回空配置。 */
export async function loadConfig(home: string = os.homedir()): Promise<AirgapConfig> {
  try {
    const raw = await readFile(path.join(home, ".airgap", "config.json"), "utf8");
    const cfg = asRecord(JSON.parse(raw));
    if (!cfg) return {};
    const out: AirgapConfig = {};
    if (typeof cfg["language"] === "string") out.language = cfg["language"];
    const share = asRecord(cfg["share"]);
    if (share) {
      const lim = clampLimit(share["sessionListLimit"]);
      const td = asToolDisplay(share["toolDisplay"]);
      if (lim !== undefined || td !== undefined) {
        out.share = {};
        if (lim !== undefined) out.share.sessionListLimit = lim;
        if (td !== undefined) out.share.toolDisplay = td;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function sessionListLimit(cfg: AirgapConfig): number {
  return cfg.share?.sessionListLimit ?? DEFAULT_SESSION_LIST_LIMIT;
}

export function shareToolDisplay(cfg: AirgapConfig): ToolDisplay {
  return cfg.share?.toolDisplay ?? DEFAULT_TOOL_DISPLAY;
}

export interface ShareConfigPatch {
  sessionListLimit?: number;
  toolDisplay?: ToolDisplay;
}

export interface ConfigPatch extends ShareConfigPatch {
  language?: LanguagePreference;
}

export interface ConfigUpdateResult {
  language: LanguagePreference;
  sessionListLimit: number;
  toolDisplay: ToolDisplay;
}

const configUpdateQueues = new Map<string, Promise<unknown>>();

/**
 * 读-改-写 share.* 配置（share UI 的设置面板走这里持久化）：
 * 只动 patch 里给出的键，文件里的其他键（含未知键）原样保留；目录不存在则创建。
 * 文件存在但解析不了时**拒绝覆盖**（宁可保存失败，不销毁用户手写的配置）。
 * 返回写入后的最终 share 生效值。
 */
export function updateConfig(
  patch: ConfigPatch,
  home: string = os.homedir(),
): Promise<ConfigUpdateResult> {
  const file = path.join(home, ".airgap", "config.json");
  const previous = configUpdateQueues.get(file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => updateConfigUnlocked(patch, home));
  configUpdateQueues.set(file, next);
  return next.finally(() => {
    if (configUpdateQueues.get(file) === next) configUpdateQueues.delete(file);
  });
}

async function updateConfigUnlocked(
  patch: ConfigPatch,
  home: string,
): Promise<ConfigUpdateResult> {
  const out: ShareConfigPatch = {};
  if (
    patch.language !== undefined &&
    !(LANGUAGE_PREFERENCES as readonly string[]).includes(patch.language)
  ) {
    throw new Error(`language 只接受 ${LANGUAGE_PREFERENCES.join(" | ")}，收到：${String(patch.language)}`);
  }
  if (patch.sessionListLimit !== undefined) {
    const clamped = clampLimit(patch.sessionListLimit);
    if (clamped === undefined) throw new Error(`sessionListLimit 需要整数，收到：${String(patch.sessionListLimit)}`);
    out.sessionListLimit = clamped;
  }
  if (patch.toolDisplay !== undefined) {
    const td = asToolDisplay(patch.toolDisplay);
    if (td === undefined) throw new Error(`toolDisplay 只接受 ${TOOL_DISPLAYS.join(" | ")}，收到：${String(patch.toolDisplay)}`);
    out.toolDisplay = td;
  }
  const dir = path.join(home, ".airgap");
  const file = path.join(dir, "config.json");
  let raw: Record<string, unknown> = {};
  try {
    const parsed = asRecord(JSON.parse(await readFile(file, "utf8")));
    if (!parsed) throw new Error("top-level not an object");
    raw = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("~/.airgap/config.json 已存在但无法解析；为避免覆盖你的内容未保存，请手动修复后重试");
    }
  }
  if (patch.language === "auto") delete raw["language"];
  else if (patch.language !== undefined) raw["language"] = patch.language;

  if (out.sessionListLimit !== undefined || out.toolDisplay !== undefined) {
    raw["share"] = { ...(asRecord(raw["share"]) ?? {}), ...out };
  }
  await mkdir(dir, { recursive: true });
  const temporaryFile = path.join(dir, `.config.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(raw, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
  const share = asRecord(raw["share"]) ?? {};
  const merged: AirgapConfig = {
    share: {
      sessionListLimit: clampLimit(share["sessionListLimit"]),
      toolDisplay: asToolDisplay(share["toolDisplay"]),
    },
  };
  const language = raw["language"] === "en" || raw["language"] === "zh-CN" ? raw["language"] : "auto";
  return {
    language,
    sessionListLimit: sessionListLimit(merged),
    toolDisplay: shareToolDisplay(merged),
  };
}

export async function updateShareConfig(
  patch: ShareConfigPatch,
  home: string = os.homedir(),
): Promise<{ sessionListLimit: number; toolDisplay: ToolDisplay }> {
  const saved = await updateConfig(patch, home);
  return { sessionListLimit: saved.sessionListLimit, toolDisplay: saved.toolDisplay };
}
