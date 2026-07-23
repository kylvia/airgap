# Inline Session Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render original Claude Code and Codex user-attached images when their session records contain safe inline image data.

**Architecture:** Keep text and binary presentation data separate by adding optional validated images to each parsed `Turn`. Source-specific parsers normalize Claude base64 blocks and Codex data URLs into one `UserImage` type; the existing HTML path renders them inside the user bubble while text-only consumers continue using `[图片]`.

**Tech Stack:** TypeScript, Vitest, markdown-it, tsup

---

## File structure

- Modify `src/types.ts`: define the shared inline-image contract and attach it optionally to `Turn`.
- Modify `src/render/turns.ts`: validate/normalize image blocks, retain image-only turns, and populate `Turn.userImages`.
- Modify `src/render/html.ts`: render normalized images without exposing raw unvalidated URLs.
- Modify `test/turns.test.ts`: cover both transcript dialects and invalid-image fallbacks.
- Modify `test/render.test.ts`: cover HTML output, placeholder removal, and text-export isolation.

### Task 1: Parse and normalize safe session images

**Files:**
- Modify: `src/types.ts:151-173`
- Modify: `src/render/turns.ts:160-380`
- Test: `test/turns.test.ts:19-145`

- [ ] **Step 1: Write failing parser tests**

Add inline `JsonlRecord` builders and tests that express the source formats without adding multi-megabyte fixtures:

```ts
function record(json: Record<string, unknown>): JsonlRecord {
  return { raw: JSON.stringify(json), lineNo: 1, json };
}

it("keeps Claude embedded images on text and image-only turns", () => {
  const turns = extractTurns([
    record({
      type: "user",
      timestamp: "2026-07-23T01:00:00.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "看这张图" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
        ],
      },
    }),
    record({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" } }],
      },
    }),
  ], "claude");

  expect(turns).toHaveLength(2);
  expect(turns[0]!.userText).toBe("看这张图\n[图片]");
  expect(turns[0]!.userImages).toEqual([
    { mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" },
  ]);
  expect(turns[1]!.userText).toBe("[图片]");
  expect(turns[1]!.userImages?.[0]?.mediaType).toBe("image/jpeg");
});

it("keeps Codex data images and opens image-only turns", () => {
  const turns = extractTurns([
    record({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "解释截图" },
          { type: "input_image", image_url: "data:image/webp;base64,QUJDRA==", detail: "auto" },
        ],
      },
    }),
    record({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: "data:image/gif;base64,QUJDRA==" }],
      },
    }),
  ], "codex");

  expect(turns).toHaveLength(2);
  expect(turns[0]!.userText).toBe("解释截图\n[图片]");
  expect(turns[0]!.userImages?.[0]?.dataUrl).toBe("data:image/webp;base64,QUJDRA==");
  expect(turns[1]!.userText).toBe("[图片]");
  expect(turns[1]!.userImages?.[0]?.mediaType).toBe("image/gif");
});

it("keeps placeholders but rejects unsafe or unavailable image sources", () => {
  const claudeTurns = extractTurns([
    record({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/svg+xml", data: "PHN2Zz4=" } },
          { type: "image", file: { path: "/tmp/private.png" } },
        ],
      },
    }),
  ], "claude");
  const codexTurns = extractTurns([
    record({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_image", image_url: "https://example.com/private.png" },
          { type: "input_image", image_url: "data:image/png;base64,not base64" },
        ],
      },
    }),
  ], "codex");

  expect(claudeTurns[0]!.userText).toBe("[图片]\n[图片]");
  expect(claudeTurns[0]!.userImages).toBeUndefined();
  expect(codexTurns[0]!.userText).toBe("[图片]\n[图片]");
  expect(codexTurns[0]!.userImages).toBeUndefined();
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```bash
npx vitest run test/turns.test.ts
```

Expected: FAIL because `Turn.userImages` does not exist and Codex image-only messages are currently discarded.

- [ ] **Step 3: Add the shared image type**

Add to `src/types.ts` immediately before `Turn`:

```ts
export type InlineImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface UserImage {
  mediaType: InlineImageMediaType;
  dataUrl: string;
}

export interface Turn {
  index: number;
  userText: string;
  userImages?: UserImage[];
  assistant: TurnBlock[];
  timestamp: string | null;
}
```

- [ ] **Step 4: Implement strict normalization and source extraction**

Import `UserImage`, then add focused helpers in `src/render/turns.ts`:

```ts
const INLINE_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function parseInlineImageDataUrl(value: unknown): UserImage | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || !match[1] || !match[2] || match[2].length % 4 !== 0) return null;
  const mediaType = match[1].toLowerCase();
  if (!INLINE_IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  return { mediaType: mediaType as UserImage["mediaType"], dataUrl: value };
}

function claudeImage(block: Record<string, unknown>): UserImage | null {
  if (block["type"] !== "image") return null;
  const source = asRecord(block["source"]);
  if (!source || source["type"] !== "base64") return null;
  const mediaType = source["media_type"];
  const data = source["data"];
  return typeof mediaType === "string" && typeof data === "string"
    ? parseInlineImageDataUrl(`data:${mediaType};base64,${data}`)
    : null;
}

function imagesFromContent(content: unknown, source: SessionSource): UserImage[] {
  if (!Array.isArray(content)) return [];
  const images: UserImage[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    const image = source === "claude"
      ? claudeImage(block)
      : block["type"] === "input_image"
        ? parseInlineImageDataUrl(block["image_url"])
        : null;
    if (image) images.push(image);
  }
  return images;
}
```

Extend the Codex user-text extraction so every `input_image` contributes `[图片]`, while assistant text extraction remains unchanged. When creating either source's `Turn`, call `imagesFromContent(...)` and conditionally spread `{ userImages }` only when the array is non-empty:

```ts
function codexUserText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    if (
      (block["type"] === "input_text" || block["type"] === "text")
      && typeof block["text"] === "string"
      && block["text"].trim()
    ) {
      parts.push(block["text"].trim());
    } else if (block["type"] === "input_image") {
      parts.push("[图片]");
    }
  }
  const text = parts.join("\n").trim();
  return text.length > 0 ? text : null;
}

const userImages = imagesFromContent(message["content"], "claude");
current = {
  index: turns.length + 1,
  userText,
  ...(userImages.length > 0 ? { userImages } : {}),
  assistant: [],
  timestamp: recordTimestamp(j),
};

const userImages = imagesFromContent(payload["content"], "codex");
current = {
  index: turns.length + 1,
  userText,
  ...(userImages.length > 0 ? { userImages } : {}),
  assistant: [],
  timestamp: recordTimestamp(j),
};
```

Use `codexUserText` only in `userTextFromRecord` for role=user records, retaining `codexMessageText` for assistant messages. Apply `isCodexScaffold` to the resulting text before opening a turn. Do not decode, fetch, or read image paths.

- [ ] **Step 5: Run parser tests and verify GREEN**

Run:

```bash
npx vitest run test/turns.test.ts
```

Expected: all tests in `test/turns.test.ts` pass.

- [ ] **Step 6: Commit the parsing unit**

```bash
git add src/types.ts src/render/turns.ts test/turns.test.ts
git commit -m "feat: retain inline session images"
```

### Task 2: Render user images without contaminating text exports

**Files:**
- Modify: `src/render/html.ts:102-112,311-337`
- Test: `test/render.test.ts:1-175`

- [ ] **Step 1: Write failing renderer tests**

Add one safe inline image to the first shared fixture turn:

```ts
userText: '帮我看看 <script>alert("x")</script> 这段\n[图片]',
userImages: [
  { mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" },
],
```

Then add assertions:

```ts
it("renders validated user images and hides their resolved placeholders", () => {
  const imageTurn: Turn = {
    index: 1,
    userText: "查看截图\n[图片]",
    userImages: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }],
    assistant: [],
    timestamp: null,
  };
  const html = renderHtml([imageTurn], meta);
  expect(html).toContain('class="user-attachment"');
  expect(html).toContain('src="data:image/png;base64,QUJDRA=="');
  expect(html).toContain("查看截图");
  expect(html).not.toContain("[图片]");
});

it("renders image-only turns without an empty text node", () => {
  const html = renderHtml([{
    index: 1,
    userText: "[图片]",
    userImages: [{ mediaType: "image/jpeg", dataUrl: "data:image/jpeg;base64,QUJDRA==" }],
    assistant: [],
    timestamp: null,
  }], meta);
  expect(html).toContain('class="user-attachments"');
  expect(html).not.toContain(">[图片]<");
});

it("keeps binary payloads out of Markdown export", () => {
  const md = renderMarkdown(turns, meta);
  expect(md).toContain("[图片]");
  expect(md).not.toContain("data:image/");
  expect(md).not.toContain("QUJDRA==");
});
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
npx vitest run test/render.test.ts
```

Expected: FAIL because `renderTurnBlock` does not render `userImages`.

- [ ] **Step 3: Implement user-image HTML and CSS**

Add user-attachment rules next to `.msg-user .bubble`:

```css
.msg-user .user-text { margin-bottom: 10px; }
.msg-user .user-attachments { display: grid; gap: 8px; }
.msg-user .user-attachment {
  display: block; max-width: 100%; height: auto;
  border-radius: var(--radius-input);
}
```

Add a renderer that removes only as many standalone parser-generated placeholders as there are resolved images, leaving unresolved placeholders visible:

```ts
function renderUserContent(turn: Turn, i18n: I18n): string {
  let resolved = turn.userImages?.length ?? 0;
  const visibleText = turn.userText
    .split("\n")
    .filter((line) => {
      if (resolved > 0 && line.trim() === "[图片]") {
        resolved -= 1;
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
  const text = visibleText
    ? `<div class="user-text">${escapeHtml(visibleText).replace(/\n/g, "<br>")}</div>`
    : "";
  const images = (turn.userImages ?? [])
    .map((image) => `<img class="user-attachment" src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(i18n.t("share.tag.image"))}">`)
    .join("");
  const attachments = images ? `<div class="user-attachments">${images}</div>` : "";
  return `${text}${attachments}`;
}
```

Replace the direct `turn.userText` interpolation in `renderTurnBlock` with `renderUserContent(turn, i18n)`. Keep the bubble itself for pure-image turns.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run:

```bash
npx vitest run test/render.test.ts
```

Expected: all tests in `test/render.test.ts` pass, including XSS and zero-external-link coverage.

- [ ] **Step 5: Run parser and renderer tests together**

Run:

```bash
npx vitest run test/turns.test.ts test/render.test.ts
```

Expected: both suites pass with zero failures.

- [ ] **Step 6: Commit the rendering unit**

```bash
git add src/render/html.ts test/render.test.ts
git commit -m "feat: render inline user images"
```

### Task 3: Full verification

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete root test suite**

```bash
npm test
```

Expected: all root Vitest suites pass with zero failures.

- [ ] **Step 3: Run desktop tests**

```bash
npm run desktop:test
```

Expected: all desktop Vitest suites pass with zero failures.

- [ ] **Step 4: Build root and desktop bundles**

```bash
npm run build
npm run desktop:build
```

Expected: both commands exit 0 and produce their normal bundles.

- [ ] **Step 5: Inspect the final task diff**

```bash
git status --short
git diff HEAD~2 --check
git diff HEAD~2 --stat
```

Expected: no whitespace errors; changes are limited to the design/plan documents, shared render types, turn parsing, HTML rendering, and their tests.
