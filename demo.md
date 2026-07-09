# Dossier — Style Reference
> minimalist-ui warm document interface for airgap local transcript output

**Theme:** light-first, with a warm deep-paper dark variant.

Dossier 是 airgap 面向人 HTML 的紧凑视觉参考：`airgap show` 导出 transcript HTML/PNG 与本地 `airgap share` picker UI。`design.md` 和 `design.dark.md` 是 live spec；`src/render/theme.ts` 是色彩 token 的唯一代码源。

## Tokens

| Role | Value | Use |
|------|-------|-----|
| Warm bone | `#fbfbfa` | Page and preview canvas |
| Paper | `#ffffff` | Cards, panels, controls |
| Off-black | `#1a1a1a` | Primary text, hairlines, action fill (never pure #000) |
| Charcoal | `#2f3437` | Secondary text |
| Graphite | `#787774` | Muted metadata |
| Pastel green | `#edf3ec` / `#346538` | ok / success |
| Pastel red | `#fdebec` / `#9f2f2d` | err / danger |
| Pastel yellow | `#fbf3db` / `#956400` | warning |
| Pastel blue | `#e1f3fe` / `#1f6c9f` | info / tag |

Color is scarce: pastels are semantic only, never decoration or large fills. Structural card/toolcard borders are `#eaeaea` hairlines with no shadow.

## Typography

- Headings: editorial serif (Newsreader / Instrument / Playfair fallback), weight 600, tight tracking -0.02em.
- Body and UI: SF Pro / Geist-like sans. **Never Inter or Roboto.**
- Technical content: mono (Geist Mono / SF Mono) for code, tool names, inputs, metadata.
- Exported HTML must not load remote fonts; system stacks only.

## Shape And Depth

- Cards and toolcards: 10px radius, 1px `#eaeaea` hairline, no shadow.
- Buttons: primary is an off-black square button (6px radius, not a pill); secondary is a ghost square button with ink border.
- Page bars: flat paper, no translucent toolbar material, no CSS backdrop filters.

## Components

- `.msg-user`: right-aligned paper bubble with a thin green accent edge; never black fill for long user text.
- `.msg-ai`: paper transcript card with a `#eaeaea` hairline border.
- `.toolcard`: flat execution card, tool name + status glyph (`✓` / `✗`), mono input/output; ok = pastel green, err = pastel red.
- Thinking disclosure: quiet, inline SVG mark (no emoji), charcoal text, hairline left rule.
- Warning banner: pastel-yellow band with an inline SVG warn mark plus text, never color-only.
- No emoji anywhere in HTML/UI — use inline SVG primitives. Markdown text export keeps its glyphs.

## Constraints

- Colors live in `src/render/theme.ts`; docs mirror the implementation and must update with token changes.
- Exported HTML, iframe preview, and share shell use zero remote assets.
- Preserve JS/DOM anchors documented in `design.md`.
- `buildPreviewShell()` must stay aligned with `renderHtml()` outer transcript structure.
- Template strings hold CSS/HTML/JS; avoid bare interpolation markers and bare backticks.
- Dark mode overrides tokens in `theme.ts` via `prefers-color-scheme: dark`; semantic aliases follow automatically.
