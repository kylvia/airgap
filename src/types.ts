/** Shared contracts for all airgap modules. Do not add module-specific types here. */

// ---------- discovery ----------

export type SessionSource = "claude" | "codex";

export interface SidecarFiles {
  /** <projDir>/<sid>/subagents/agent-*.jsonl (+ matching agent-*.meta.json) */
  subagents: string[];
  /** <projDir>/<sid>/tool-results/toolu_*.txt — externalized large tool outputs */
  toolResults: string[];
}

export interface SessionInfo {
  source: SessionSource;
  /** session id (uuid for claude, uuid suffix of rollout filename for codex) */
  id: string;
  /** absolute path of the main transcript jsonl */
  file: string;
  /** original working directory of the session, read from first record when available */
  cwd: string | null;
  /** display label for grouping (cwd if known, else munged dir name) */
  project: string;
  mtimeMs: number;
  sizeBytes: number;
  sidecars: SidecarFiles;
}

export interface DiscoverOptions {
  home?: string;
  sources?: SessionSource[];
  /** only sessions whose project/cwd contains this substring */
  project?: string;
}

// ---------- detection ----------

export type Severity = "critical" | "high" | "medium";

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  /** cheap substring used to prefilter raw lines before JSON.parse */
  prefilter?: string;
  pattern: RegExp;
}

export interface RuleMatch {
  ruleId: string;
  severity: Severity;
  /** the exact secret text matched */
  secret: string;
  /** masked preview: first4…last4 */
  preview: string;
}

export interface Finding extends RuleMatch {
  sourceFile: string;
  sessionId: string;
  source: SessionSource;
  project: string;
  lineNo: number;
  /** dot-path of the JSON field that contained the match, if structured */
  fieldPath?: string;
  /** occurrences of the same secret within this session */
  count: number;
}

// ---------- slicing / packing ----------

export interface JsonlRecord {
  raw: string;
  lineNo: number;
  json: Record<string, unknown> | null;
}

export interface SliceOptions {
  /** keep only the last N user-turns (prompt chains); undefined = whole session */
  tail?: number;
  /** strip assistant thinking blocks (drops signature problem entirely) */
  stripThinking?: boolean;
}

export interface SliceReport {
  totalRecords: number;
  keptRecords: number;
  droppedTypes: Record<string, number>;
  toolUsePairs: number;
  subagentFiles: number;
  toolResultFiles: number;
  /** true when every tool_use has a matching tool_result inside the slice */
  closureComplete: boolean;
  /** true when a retained compact summary was re-parented as the slice's active root (F12) */
  compactSummaryRerooted?: boolean;
}

export interface SlicedSession {
  info: SessionInfo;
  records: JsonlRecord[];
  sidecars: SidecarFiles;
  report: SliceReport;
}

export interface RedactionAnnotation {
  ruleId: string;
  severity: Severity;
  placeholder: string;
  count: number;
}

export interface RedactResult {
  records: JsonlRecord[];
  annotations: RedactionAnnotation[];
  /** secret -> placeholder; stored locally, never inside the pack */
  reverseMap: Record<string, string>;
}

export const SPEC_VERSION = 1;

export interface PackManifest {
  specVersion: number;
  producer: string; // "airgap/<version>"
  createdAt: string; // ISO
  source: {
    tool: SessionSource;
    toolVersion: string | null;
    dialect: string; // e.g. "claude-jsonl-tree/1", "codex-rollout/1"
  };
  sessionId: string;
  title?: string;
  /** path tokens applied to record contents: token -> original absolute path */
  pathTokens: Record<string, string>;
  entries: Array<{ path: string; sha256: string; role: "transcript" | "subagent" | "tool-result" | "meta" }>;
  redaction: RedactionAnnotation[];
  slice: SliceReport;
}

// ---------- rendering (show) ----------

export interface TurnBlock {
  kind: "text" | "thinking" | "tool";
  /** text/thinking body; for tool blocks: one-line summary "ToolName: brief" (fallback + markdown) */
  text: string;
  /** tool blocks only: tool name, e.g. "Bash" / "Edit" */
  toolName?: string;
  /** tool blocks only: full structured input (command / file path / params), may be multi-line, capped */
  toolInput?: string;
  /** tool blocks only: execution result summary (first lines, truncated) */
  toolResult?: string;
  /** tool blocks only: the result was an error */
  toolError?: boolean;
}

export interface Turn {
  index: number; // 1-based
  userText: string;
  assistant: TurnBlock[];
  timestamp: string | null;
}

// ---------- command wiring ----------
// each src/commands/<name>.ts exports: register<Name>(program: Command): void
