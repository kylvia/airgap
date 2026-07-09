# airgap 模块契约（builder agent 必读）

所有共享类型在 `src/types.ts`（只读，不得修改）。工具函数在 `src/util/jsonl.ts`、`src/util/text.ts`（只读）。
ESM 项目：相对导入必须带 `.js` 后缀（`import { streamLines } from "../util/jsonl.js"`）。
Node ≥18，TS strict。测试用 vitest，放 `test/`，fixtures 放 `test/fixtures/`。

## 模块归属与导出签名

### A 组（M1 扫描栈）
- `src/discovery.ts`
  - `export async function discoverSessions(opts: DiscoverOptions): Promise<SessionInfo[]>`
  - `export function mungeCwd(cwd: string): string` — `/` 和 `.` 都替换为 `-`
  - `export function claudeProjectsDir(home: string): string` / `codexSessionsDir(home: string): string`
- `src/detect/rules.ts`
  - `export const RULES: Rule[]`（见下"检测规则"）
  - `export const PREFILTER: RegExp` — 各 rule prefilter 子串合并的一次性快筛
- `src/detect/scanner.ts`
  - `export function scanString(value: string): RuleMatch[]` — 纯函数，供 M2 redact 复用
  - `export async function scanSessionFile(info: SessionInfo): Promise<Finding[]>` — 流式，raw 行先过 PREFILTER 再 JSON.parse，用 `walkStrings`（skipKeys=METADATA_KEYS）只扫字符串值；sidecar 的 tool-results/*.txt 直接整行扫；同一 (ruleId, secret) 在一个会话内去重、累加 count
- `src/commands/scan.ts`
  - `export function registerScan(program: Command): void`
  - `airgap scan [--json] [--source claude|codex] [--project <substr>] [--list]`
  - 输出：按 project 分组的彩色表（picocolors，手写列对齐）：项目、含密会话数/总数、按严重度计数、最老命中天数（文件 mtime）；`--list` 逐条打印（masked preview）；底部一行总结；有命中 exit code 1
- 测试：`test/detect.test.ts`（每条规则的命中/不命中 fixture 字符串、熵过滤、假阳性守卫）、`test/discovery.test.ts`（用 `test/fixtures/home/` 假目录树验证双源发现 + sidecar 收集）

### B 组（M2 搬运栈）
- `src/slice.ts`
  - `export async function sliceSession(info: SessionInfo, opts: SliceOptions): Promise<SlicedSession>`
  - 闭包规则见下"Claude JSONL 结构"。tail=N：保留最后 N 个 prompt 链（按 user 类型且非 tool_result 承载记录分界）
- `src/redact.ts`
  - `export function redactRecords(records: JsonlRecord[], scan: (s: string) => RuleMatch[]): RedactResult`（保留，内部走 createRedactor）
  - `export function createRedactor(scan): Redactor` — 共享一致性映射，`.redactRecords(records)` / `.redactText(text)` / `.result()`，主 transcript 与任意 sidecar 同 secret 同占位符（F1）
  - 一致性映射：同一 secret → 同一占位符 `<ruleId 大写>-REDACTED-<per-pack 随机 6 位 hex>`（F5：与 secret 无关、包内一致、跨包不一致，占位符对明文零信息泄露）；只通过 `walkStrings`（METADATA_KEYS）改字符串值；改后重新序列化到 `raw`
  - F3 防御纵深：按 secret 长度降序替换；改写后再 scan 一遍，仍命中则 fail-closed 抛错拒绝写包
- `src/ccpack.ts`
  - `export async function writePack(outFile: string, sliced: SlicedSession, redact: RedactResult, extra: { toolVersion: string | null; sidecarContents: Array<{ path: string; role: "subagent"|"tool-result"|"meta"; content: string }> }): Promise<PackManifest>`（F1：sidecar 内容由调用方脱敏后传入，writePack 不再读原文件）
  - `export async function readPack(file: string): Promise<{ manifest: PackManifest; extract(destDir: string): Promise<void> }>`（yauzl 读，防 zip-slip：拒绝绝对路径与 `..`）
  - zip 内布局：`manifest.json`、`transcript.jsonl`、`subagents/*`、`tool-results/*`
  - 路径 token：写包前把记录内容中的项目绝对路径→`{{PROJECT_ROOT}}`、home→`{{HOME}}`（只在内容字符串里替换，同样走 walkStrings）
- `src/commands/pack.ts`
  - `export function registerPack(program: Command): void`
  - `airgap pack [--last] [--session <prefix>] [--tail N] [--out <file>] [--yes] [--no-redact --accept-risk] [--strip-thinking]`
  - `--last`：cwd 对应项目最近 mtime 的会话。默认输出 `<slug>-<yyMMdd>.ccpack`
  - 交互确认（@clack/prompts）：逐条 finding 显示 preview + 所在字段，[r]edact/[k]eep 全部确认后写包；`--yes` 全部 redact；reverse map 写 `~/.airgap/maps/<packname>.json`（mode 0600）
- `src/commands/open.ts`
  - `export function registerOpen(program: Command): void`
  - `airgap open <file> [--project <dir>] [--print-only]`
  - 流程：readPack → 校验 sha256 → 打印信任回执（redaction annotations + slice report）→ 询问/推断目标项目目录 → 还原路径 token → 生成新 sessionId（randomUUID，fork 语义）并重写所有 sessionId 字段 + cwd 字段 → 写入 `~/.claude/projects/<munge(目标cwd)>/<newSid>.jsonl` + sidecars → 打印 `claude --resume <newSid>` 与兜底 `claude --resume <安装的绝对路径> --fork-session` 两条命令；`--print-only` 只解包到临时目录并打印文件路径
  - 注意：**绝不覆盖已存在文件**；索引注册机制未知（等实验组结论），先不写 sessions-index，依赖两条 resume 命令兜底
- `src/commands/doctor.ts`
  - `export function registerDoctor(program: Command): void` — 打印本机 claude/codex 版本（`claude --version` 子进程，失败容错）、airgap 版本、支持矩阵占位
- 测试：`test/slice.test.ts`、`test/redact.test.ts`（redact 前后断言 uuid/parentUuid/tool_use_id/signature 零变动 + 一致性映射）、`test/ccpack.test.ts`（写→读 roundtrip + zip-slip 拒绝）。scanner 依赖用 `scanString` 的契约签名 mock（`vi.fn`），不 import A 组文件跑测试

### C 组（M3 出图栈）
- `src/render/turns.ts`
  - `export function extractTurns(records: JsonlRecord[], source: SessionSource): Turn[]`
  - Claude：type=user 且 message.content 含用户文本（非 tool_result 承载、非 isMeta）开启新 turn；其后 assistant 记录的 text/thinking/tool_use block 归入该 turn；tool_use 折叠为一行 `工具名: input 摘要（≤80 字符）`
  - Codex：response_item 线性流，message role=user 开新 turn，输出同理
- `src/render/markdown.ts` — `export function renderMarkdown(turns: Turn[], meta: { title: string; date: string }): string`
- `src/render/html.ts` — `export function renderHtml(turns: Turn[], meta): string` — Dossier 单文件 transcript HTML：header、turn blocks、footer；warm bone canvas、paper card、off-black text/hairlines、muted pastel 语义点缀；消息、toolcard、thinking disclosure、code block 都走 flat transcript card/toolcard 样式，靠 1px 边框与 10px radius 建立层级；markdown→html 用 markdown-it（`html:false` 转义 raw HTML、默认 validateLink 拦危险协议、图片仅放行 `data:` URI），GFM 表格/删除线/任务列表/blockquote/嵌套/斜体/hr 全覆盖、默认 XSS-safe 且零外链
- `src/server/page.ts` — `export function renderPage(defaultSession?: string): string` — `airgap share` 本地 picker/share shell：会话选择、左侧 turn list、右侧 iframe preview、warning banner、footer primary/ghost buttons 和 export 控件都归这里；`buildPreviewShell()` 只复用 transcript 外层结构与 `CHAT_CSS`，必须与 `renderHtml()` 的 header/turn/footer 结构保持同步
- `src/commands/show.ts`
  - `export function registerShow(program: Command): void`
  - `airgap show [--last N] [--pick] [--session <prefix>] [--md|--html|--png] [--out <file>]`
  - `--pick`：@clack/prompts multiselect，选项 label=`第N轮 <用户文本前40字>`
  - 默认 `--html`；`--png` 用系统 Chrome + DevTools Protocol 生成，找不到 Chrome 则报错并提示用 --html
  - 出图前对选中内容跑 scan（契约 `scanString` mock 同 B 组规则），有命中先列出并要求确认（--yes 跳过）
- 测试：`test/turns.test.ts`（fixture jsonl → turns）、`test/render.test.ts`（md/html snapshot 要点断言）

## Claude JSONL 结构（实测 2.1.197/198）

- 位置：`~/.claude/projects/<munged-cwd>/<sid>.jsonl`；munge = cwd 的 `/` 与 `.` → `-`
- sidecar：`<同目录>/<sid>/subagents/agent-*.jsonl`（+ `agent-*.meta.json`）、`<同目录>/<sid>/tool-results/toolu_*.txt`
- 每行一个 JSON：公共字段 `uuid`、`parentUuid`（单亲指针→树）、`promptId`（同一用户轮共享）、`isSidechain`、`isMeta`、`sessionId`、`timestamp`、`cwd`、`version`、`gitBranch`、`type`
- type 取值：`user`、`assistant`、`system`、`attachment`、`mode`、`permission-mode`、`ai-title`、`last-prompt`、`file-history-snapshot`、`queue-operation`、`progress`、`summary`
- assistant 记录：`message` 为完整 API message（`id`=msg_*、`content[]` 块：`text`/`thinking`/`tool_use`）；**同一次 API 响应拆成多条 jsonl 记录，共享 message.id**；thinking 块带加密 `signature` 字段
- tool_result 以 user 记录承载：`message.content[].{type:"tool_result",tool_use_id}` + 顶层 `toolUseResult`（结构化原始结果，可能含 stdout/stderr）+ `sourceToolAssistantUUID`
- **闭包规则（slice 必须满足）**：(a) 沿 parentUuid 的连续子链；(b) tool_use↔tool_result 必须配对，不许跨切割边界断开；(c) 同 message.id 的多条记录不可拆散；(d) 引用的 subagents 与 tool-results 文件一并携带；(e) 链头记录 parentUuid 重写为 null；(f) `mode`/`ai-title`/`attachment`/`last-prompt`/`file-history-snapshot`/`queue-operation`/`progress` 属会话级状态可丢弃（计入 droppedTypes），带 `isCompactSummary` 的 user 记录必须保留

## Codex rollout 结构

- 位置：`~/.codex/sessions/YYYY/MM/DD/rollout-<时间戳>-<uuid>.jsonl`
- 首行 `{type:"session_meta", payload:{id, cwd, cli_version, ...}}`
- 其后 `{timestamp, type, payload}` 线性流水：`response_item`（payload.type: `message`{role,content[{type:"input_text"|"output_text",text}]} / `function_call`{name,arguments} / `function_call_output`{output} / `reasoning`）、`event_msg`、`turn_context`

## 检测规则（A 组实现，全表）

| id | severity | 模式要点 |
|---|---|---|
| anthropic-key | critical | `sk-ant-[A-Za-z0-9_-]{20,}` |
| openai-key | critical | `sk-proj-[A-Za-z0-9_-]{20,}` 或含 `T3BlbkFJ` 标记的 sk- 串 |
| github-token | critical | `(ghp\|gho\|ghu\|ghs\|ghr)_[A-Za-z0-9]{36}`、`github_pat_[A-Za-z0-9_]{22,}` |
| aws-access-key | critical | `(AKIA\|ASIA\|ABIA\|ACCA)[0-9A-Z]{16}` |
| aws-secret-key | high | 上下文式：`aws.{0,20}secret.{0,20}[:=]\s*['"]?[A-Za-z0-9/+=]{40}`（大小写不敏感） |
| google-api-key | critical | `AIza[0-9A-Za-z_-]{35}` |
| slack-token | critical | `xox[baprs]-[0-9A-Za-z-]{10,}` |
| stripe-key | critical | `(sk\|rk)_live_[0-9a-zA-Z]{24,}` |
| npm-token | high | `npm_[A-Za-z0-9]{36}` |
| telegram-bot | high | `[0-9]{8,10}:AA[A-Za-z0-9_-]{33}` |
| private-key | critical | 整块 `-----BEGIN (RSA\|EC\|OPENSSH\|DSA\|PGP )?PRIVATE KEY-----[\s\S]*?-----END …-----`（含 base64 密钥体与 END），外加 header-only 兜底匹配截断块 |
| jwt | medium | `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` |
| url-credentials | high | `[a-z][a-z0-9+.-]*://[^/\s:@'"]{3,}:[^/\s:@'"]{3,}@` |
| bearer-token | medium | `(?i)bearer\s+[A-Za-z0-9._~+/-]{25,}`（值须熵 > 3.5） |
| generic-assignment | medium | `(?i)(api[_-]?key\|secret\|token\|passwd\|password)['"]?\s*[=:]\s*['"]?[A-Za-z0-9_./+=-]{16,}`（值须熵 > 3.5） |
| env-dump | high | 一个字符串值内 ≥3 行匹配 `^[A-Z][A-Z0-9_]{2,}=\S.*$`（匹配到行尾，含空格/带引号的值整值被脱；注意 raw 里换行是 `\n` 字面量或真实换行） |

假阳性守卫（scanString 内统一）：命中值包含 `REDACTED`/`EXAMPLE`/`example`/`your-`/`xxxx`/`****`/`<`、或整体是重复字符时丢弃。

## 通用纪律

- 不 `git commit`（集成者统一提交）；不改归属之外的文件；不跑 `npm install`（已装好）
- 只读真实数据（`~/.claude`、`~/.codex`）用于本地验证可以，但**绝不修改**
- 每组完成后跑 `npx vitest run test/<自己的文件>` 全绿，再跑 `npx tsc --noEmit` 若报的错都在别组未完成文件里可忽略
- 你的最终回复 = 交付报告：文件清单、测试结果、对契约的任何偏离（必须显式列出）
