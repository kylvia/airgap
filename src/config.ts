import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * ~/.airgap/config.json 的已知键。所有键可缺省，未知键忽略；
 * 文件缺失 / JSON 损坏 / 字段非法一律静默回退默认——配置永远不能让命令挂掉。
 */
export interface AirgapConfig {
  share?: {
    /** share 会话下拉最多列多少个（常用 10 / 20 / 50）；整数，clamp 到 [1, 200] */
    sessionListLimit?: number;
  };
}

export const DEFAULT_SESSION_LIST_LIMIT = 50;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function clampLimit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return Math.min(200, Math.max(1, v));
}

/** 读 ~/.airgap/config.json（home 可注入便于测试）；任何异常都返回空配置。 */
export async function loadConfig(home: string = os.homedir()): Promise<AirgapConfig> {
  try {
    const raw = await readFile(path.join(home, ".airgap", "config.json"), "utf8");
    const cfg = asRecord(JSON.parse(raw));
    if (!cfg) return {};
    const out: AirgapConfig = {};
    const share = asRecord(cfg["share"]);
    if (share) {
      const lim = clampLimit(share["sessionListLimit"]);
      if (lim !== undefined) out.share = { sessionListLimit: lim };
    }
    return out;
  } catch {
    return {};
  }
}

export function sessionListLimit(cfg: AirgapConfig): number {
  return cfg.share?.sessionListLimit ?? DEFAULT_SESSION_LIST_LIMIT;
}

/**
 * 读-改-写 share.sessionListLimit（share UI 的条数选择器走这里持久化）：
 * 只动这一个键，文件里的其他键（含未知键）原样保留；目录不存在则创建。
 * 文件存在但解析不了时**拒绝覆盖**（宁可保存失败，不销毁用户手写的配置）。
 */
export async function updateSessionListLimit(limit: number, home: string = os.homedir()): Promise<number> {
  const clamped = clampLimit(limit);
  if (clamped === undefined) throw new Error(`sessionListLimit 需要整数，收到：${String(limit)}`);
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
  const share = asRecord(raw["share"]) ?? {};
  raw["share"] = { ...share, sessionListLimit: clamped };
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return clamped;
}
