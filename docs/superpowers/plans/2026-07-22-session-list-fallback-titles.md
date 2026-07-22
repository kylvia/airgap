# Session List Fallback Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a bounded first-user-message fallback in the Share session picker whenever a transcript has no stored custom or AI title.

**Architecture:** Keep transcript files as the only source of truth. Extract one source-aware, record-level user-message helper from the existing turn parser, then reuse it in a constant-memory list-title scanner that preserves native-title precedence and fails soft.

**Tech Stack:** TypeScript ESM, Node.js streams, Vitest, existing Airgap Share server and JSONL utilities.

---

### Task 1: Share record-level user-message extraction

**Files:**
- Modify: `src/render/turns.ts`
- Test: `test/turns.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Update the import in `test/turns.test.ts` and add focused tests proving that the
new helper accepts real prompts and rejects source-specific noise:

```ts
import { extractTurns, userTextFromRecord } from "../src/render/turns.js";

describe("userTextFromRecord", () => {
  it("extracts a real Claude user message and rejects metadata/tool carriers", () => {
    expect(
      userTextFromRecord(
        { type: "user", message: { role: "user", content: "  修复这个报错  " } },
        "claude",
      ),
    ).toBe("修复这个报错");
    expect(
      userTextFromRecord(
        { type: "user", isMeta: true, message: { role: "user", content: "injected" } },
        "claude",
      ),
    ).toBeNull();
    expect(
      userTextFromRecord(
        {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        },
        "claude",
      ),
    ).toBeNull();
  });

  it("extracts a real Codex user message and rejects injected scaffolding", () => {
    expect(
      userTextFromRecord(
        {
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "修复登录页" }] },
        },
        "codex",
      ),
    ).toBe("修复登录页");
    expect(
      userTextFromRecord(
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }],
          },
        },
        "codex",
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run test/turns.test.ts
```

Expected: FAIL because `userTextFromRecord` is not exported.

- [ ] **Step 3: Implement the shared helper**

Add the source-aware helper after the existing Claude and Codex text helpers in
`src/render/turns.ts`:

```ts
export function userTextFromRecord(j: Record<string, unknown>, source: SessionSource): string | null {
  if (source === "claude") {
    if (j["type"] !== "user") return null;
    if (j["isSidechain"] === true || j["isMeta"] === true || j["isCompactSummary"] === true) return null;
    const message = asRecord(j["message"]);
    return message ? claudeUserText(message["content"]) : null;
  }

  if (j["type"] !== "response_item") return null;
  const payload = asRecord(j["payload"]);
  if (!payload || payload["type"] !== "message" || payload["role"] !== "user") return null;
  const text = codexMessageText(payload["content"]);
  return text && !isCodexScaffold(text) ? text : null;
}
```

Refactor `extractClaudeTurns()` and `extractCodexTurns()` to call the helper for
user records while leaving assistant aggregation and Claude tool-result
attachment in their current functions:

```ts
// Claude user branch, after absorbClaudeToolResult(j, toolIndex)
const userText = userTextFromRecord(j, "claude");
if (userText === null) continue;
current = { index: turns.length + 1, userText, assistant: [], timestamp: recordTimestamp(j) };
turns.push(current);

// Codex message/user branch
const text = userTextFromRecord(j, "codex");
if (text === null) continue;
current = { index: turns.length + 1, userText: text, assistant: [], timestamp: recordTimestamp(j) };
turns.push(current);
```

Keep the existing `extractTurns()` public contract and all assistant/tool
behavior unchanged.

- [ ] **Step 4: Run parser tests and typecheck**

Run:

```bash
npx vitest run test/turns.test.ts
npm run typecheck
```

Expected: both commands PASS; existing Claude and Codex turn counts and content
remain unchanged.

- [ ] **Step 5: Commit the shared extraction refactor**

```bash
git add src/render/turns.ts test/turns.test.ts
git commit -m "refactor: share session user text extraction"
```

### Task 2: Add the streaming fallback-title scanner

**Files:**
- Modify: `src/session.ts`
- Modify: `src/server/share-server.ts`
- Test: `test/session.test.ts`

- [ ] **Step 1: Replace title-peek tests with the new list-title contract**

Import `peekListTitle` instead of `peekTitle` in `test/session.test.ts`. Keep the
existing temporary JSONL helper and replace the title-peek describes with these
cases:

```ts
describe("peekListTitle", () => {
  it("keeps native-title precedence over the first user message", async () => {
    const f = await jsonlFile([
      '{"type":"user","message":{"content":"第一条真实消息"}}',
      '{"type":"ai-title","aiTitle":"AI 标题"}',
      '{"type":"custom-title","customTitle":"用户标题"}',
      '{"type":"ai-title","aiTitle":"更晚的 AI 标题"}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("用户标题");
  });

  it("uses the latest AI title when no custom title exists", async () => {
    const f = await jsonlFile([
      '{"type":"user","message":{"content":"第一条真实消息"}}',
      '{"type":"ai-title","aiTitle":"旧标题"}',
      '{"type":"ai-title","aiTitle":"新标题"}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("新标题");
  });

  it("uses the first substantive Claude prompt and skips non-title turns", async () => {
    const f = await jsonlFile([
      '{"type":"user","isMeta":true,"message":{"content":"meta"}}',
      '{"type":"user","message":{"content":"/model opus"}}',
      '{"type":"user","message":{"content":[{"type":"image"}]}}',
      '{"type":"user","message":{"content":[{"type":"document"}]}}',
      '{"type":"user","message":{"content":"  修复   登录页\\n的报错  "}}',
      '{"type":"user","message":{"content":"后续消息"}}',
    ]);
    expect(await peekListTitle(f, "claude")).toBe("修复 登录页 的报错");
  });

  it("uses the first substantive Codex prompt after scaffolding", async () => {
    const f = await jsonlFile([
      '{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"system"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<user_instructions>noise</user_instructions>"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"查一下 8080 端口"}]}}',
    ]);
    expect(await peekListTitle(f, "codex")).toBe("查一下 8080 端口");
  });

  it("bounds generated titles to 60 visible characters", async () => {
    const prompt = "x".repeat(80);
    const f = await jsonlFile([JSON.stringify({ type: "user", message: { content: prompt } })]);
    const title = await peekListTitle(f, "claude");
    expect(title).toBe(`${"x".repeat(59)}…`);
    expect(title).toHaveLength(60);
  });

  it("fails soft for missing, malformed, and candidate-free files", async () => {
    expect(await peekListTitle("/nonexistent/airgap-title.jsonl", "claude")).toBeNull();
    expect(await peekListTitle(await jsonlFile(["not json", '{"type":"user"}']), "claude")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run test/session.test.ts
```

Expected: FAIL because `peekListTitle` is not exported.

- [ ] **Step 3: Implement the constant-memory scanner**

In `src/session.ts`, import `SessionSource` and `userTextFromRecord`, then replace
`peekTitle()` with this source-aware list function:

```ts
import type { JsonlRecord, RuleMatch, SessionInfo, SessionSource, Turn } from "./types.js";
import { userTextFromRecord } from "./render/turns.js";

const LIST_TITLE_MAX = 60;

function generatedListTitle(userText: string): string | null {
  const title = oneLine(userText);
  if (!title || turnTag(title) !== "") return null;
  if (/^(?:\[图片\]|\[文档\])(?:\s*(?:\[图片\]|\[文档\]))*$/.test(title)) return null;
  return title.length > LIST_TITLE_MAX ? `${title.slice(0, LIST_TITLE_MAX - 1)}…` : title;
}

export async function peekListTitle(file: string, source: SessionSource): Promise<string | null> {
  let ai: string | null = null;
  let custom: string | null = null;
  let generated: string | null = null;
  try {
    for await (const { line } of streamLines(file)) {
      const titleLine = line.includes('-title"');
      if (!titleLine && generated !== null) continue;
      const j = tryParse(line);
      if (!j) continue;
      if (j["type"] === "custom-title" && typeof j["customTitle"] === "string" && j["customTitle"].trim()) {
        custom = j["customTitle"].trim();
      } else if (j["type"] === "ai-title" && typeof j["aiTitle"] === "string" && j["aiTitle"].trim()) {
        ai = j["aiTitle"].trim();
      } else if (generated === null) {
        const userText = userTextFromRecord(j, source);
        if (userText !== null) generated = generatedListTitle(userText);
      }
    }
  } catch {
    return null;
  }
  return custom ?? ai ?? generated;
}
```

The `generated === null` check deliberately continues looking after a filtered
command or media-only turn. Once a substantive prompt is captured, the scanner
parses only later title lines.

In `src/server/share-server.ts`, update the import and list summary call:

```ts
import { oneLine, peekListTitle, pickSession, readRecords, redactTurns, scanOneTurn, scanTurns, sessionTitle, turnTag } from "../session.js";

// inside listSessions()
title: await peekListTitle(s.file, s.source),
```

Do not change `sessionTitle()` or `fillOptions()`; preview/export title semantics
and existing project fallback remain intact.

- [ ] **Step 4: Run focused Share tests**

Run:

```bash
npx vitest run test/session.test.ts test/turns.test.ts test/share-server.test.ts
npm run typecheck
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the fallback-title behavior**

```bash
git add src/session.ts src/server/share-server.ts test/session.test.ts
git commit -m "feat: show prompt fallbacks in session list"
```

### Task 3: Verify the complete change

**Files:**
- Verify only; no new files expected

- [ ] **Step 1: Run the full automated verification set**

Run each command independently:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0; Vitest reports no failed tests; TypeScript emits
no diagnostics; `tsup` builds `dist/index.js`; `git diff --check` is silent.

- [ ] **Step 2: Inspect scope and history**

Run:

```bash
git status --short
git log -4 --oneline
git diff main...HEAD --stat
```

Expected: the worktree is clean; history contains the design, plan,
shared-parser, and feature commits; the diff contains only the design/plan
documents and the five implementation/test files named above.

- [ ] **Step 3: Record the verification receipt in the handoff**

Report the exact test count, typecheck/build results, final commit hashes, and
the worktree path. Do not create a new receipt file or alter unrelated docs.
