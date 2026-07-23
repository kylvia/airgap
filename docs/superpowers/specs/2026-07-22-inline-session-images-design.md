# Inline Session Images Design

## Goal

When a Claude Code or Codex session record contains the original image bytes, show the image in the session preview and generated HTML/image exports. A message containing only images remains a selectable conversation turn.

## Scope

- Support Claude `image` blocks with an embedded base64 `source`.
- Support Codex `input_image` blocks whose `image_url` is an inline data URL.
- Preserve the existing text-based session title, search, selection, Markdown copy, and plain-text behavior.
- Preserve current HTML and long-image export size limits and their existing oversized-export guidance.
- Do not fetch remote URLs or read arbitrary local file paths.
- Fall back to `[图片]` when the original bytes are absent, malformed, or unsupported.

## Chosen approach

Add an optional `userImages` collection to `Turn`, separate from `userText`. This keeps image payloads out of titles, search text, copied Markdown, and other text-only consumers while giving renderers a typed source of trusted inline images.

Alternatives rejected:

1. Inject image Markdown into `userText`. This is smaller initially, but leaks multi-megabyte data URLs into titles, copy operations, filtering, and text exports.
2. Replace `Turn` with a fully ordered content-block model. This preserves exact text/image interleaving, but expands the change across every consumer without a current product need. Images will instead render beneath the user text in their source order.

## Data model and parsing

Introduce a small image value containing a validated data URL and media type. The parser will:

1. Accept only `image/png`, `image/jpeg`, `image/webp`, and `image/gif`.
2. Convert valid Claude base64 sources to `data:<media-type>;base64,<data>`.
3. Preserve valid Codex inline data URLs after validating their media type and base64 form.
4. Record images in source order on the turn.
5. Keep `[图片]` in `userText` as the text-only representation. An image-only message therefore still opens a turn and receives the existing image title/tag behavior.

Invalid blocks never throw or prevent adjacent text from rendering. They contribute the placeholder only.

## Rendering and consumers

The HTML renderer will add the validated images below the user-message text using existing responsive image constraints, with an explicit class for user attachments. Because only validated inline data URLs enter the model, previews and exports remain self-contained and make no network requests.

Session listing and lightweight title extraction will recognize Claude and Codex image blocks as `[图片]` without carrying image bytes. Markdown/plain-text copying continues to contain the placeholder rather than embedded binary data.

## Topology and failure boundaries

- **State truth:** parsed `Turn.userImages`, derived synchronously from the session JSONL.
- **Observable feedback:** the same generated HTML feeds browser preview and desktop export, so one rendering path determines both results.
- **Affected consumers:** turn parsing, lightweight title extraction, HTML rendering, and tests. Slicing and text copy retain their current string contract.
- **Timing/concurrency:** parsing and rendering are synchronous and immutable; no new background work, cache, or race is introduced.

If selected images make an export exceed an existing size limit, the existing export error and text-copy guidance remain authoritative.

## Tests

- Claude text-plus-image and image-only records retain the image and placeholder.
- Codex text-plus-image and image-only records retain the image and placeholder.
- Unsupported media types, malformed data URLs, and file-only references fall back safely.
- Generated HTML contains inline user images and never emits remote image URLs.
- Existing title, selection, Markdown, zero-external-link, typecheck, build, and full test suites remain green.

## Non-goals

- OCR, image captions, thumbnails, compression, or transcoding.
- Recovering images that were never stored in the source log.
- Loading remote images or arbitrary local files.
- Redesigning assistant content into a general multimodal block model.
