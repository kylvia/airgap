# Evergreen — Style Reference
> sunlit greenhouse on linen paper for airgap local transcript output

**Theme:** light-first, with a warm deep-paper dark variant.

Evergreen is the compact visual reference for airgap's human-facing HTML: `airgap show` exported transcript HTML/PNG and the local `airgap share` picker UI. `design.md` and `design.dark.md` are the live specs; `src/render/theme.ts` is the only code source for color tokens.

## Tokens

| Role | Value | Use |
|------|-------|-----|
| Linen canvas | `#edede2` | Page and preview background |
| Bone card | `#fffff3` | Transcript cards, panels, controls |
| Ink | `#000000` | Primary text, structural hairlines, primary action fill |
| Charcoal | `#333333` | Secondary text and subdued metadata |
| Sage | `#beedc0` | Avatar, small markers, header wash only |

Sage is botanical atmosphere, not a CTA color. Structural card/toolcard borders are ink/rgba hairlines. Sage may appear as small markers, narrow accent strips, and the header wash; keep links and primary actions ink-led.

## Typography

- Headings: serif, weight 600, calm editorial contrast.
- Body and UI: Rubik-like sans for readability in dense transcript output.
- Technical content: mono for code, tool names, structured inputs, and compact metadata.
- Exported HTML must not load remote fonts; use local/system font stacks only.

## Shape And Depth

- Cards and toolcards: 10px radius, 1px ink/rgba structural hairline border, no shadow.
- Buttons: primary is a black pill with white text; secondary is a ghost pill with ink border.
- Page bars: flat paper surfaces, no translucent toolbar material and no CSS backdrop filters.
- Header sage wash may use ordinary `filter: blur(...)`; that is a foreground visual softening effect.

## Components

- `.msg-user`: compact user bubble/card aligned with transcript rhythm; it may carry a narrow sage marker strip.
- `.msg-ai`: bone transcript card with an ink/rgba hairline border.
- `.toolcard`: flat execution card with visible tool name, status, input, and optional output summary.
- Thinking disclosure: quiet, readable, and structurally stable; it may use a small glyph/emoji label and a narrow sage marker.
- Warning banner: clear text plus visual emphasis, not color-only.
- Tool, thinking, turn, and user-facing labels may include small glyph/emoji labels for compact recognition; this is presentation-only.
- Primary/ghost buttons: stable pill controls for share and export actions.

## Constraints

- Colors live in `src/render/theme.ts`; docs mirror the implementation and must be updated with token changes.
- Exported HTML, iframe preview, and share shell use zero remote assets: no remote fonts, images, scripts, or CSS.
- Preserve JS/DOM anchors documented in `design.md`.
- `src/server/page.ts` `buildPreviewShell()` must stay aligned with `src/render/html.ts` `renderHtml()` outer transcript structure.
- Template strings hold CSS/HTML/JS; avoid bare interpolation markers and bare backticks outside existing intentional patterns.
- Dark mode mainly overrides tokens in `theme.ts`; small `CHAT_CSS` dark corrections are allowed when component-level visuals need adjustment.
