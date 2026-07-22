# Tool Display Tooltip Design

**Date:** 2026-07-22

## Goal

Explain the effect of every Tool display option directly in the Share settings
panel without changing the options or their rendering behavior.

Acceptance criteria:

- an information control appears beside the Tool display label;
- mouse hover, keyboard focus, and touch focus reveal the same tooltip;
- the tooltip explains Hidden, Summary, and Full accurately in Chinese and
  English;
- the control and tooltip expose an accessible relationship to assistive
  technology;
- the existing Dossier visual rules and settings behavior remain unchanged.

## Scope

This change modifies only the Share page markup, local styling, localized copy,
and renderer tests. It does not change `ToolDisplay`, configuration persistence,
the selected default, tool rendering, export behavior, or other settings.

## Approaches Considered

### Custom information-control tooltip (selected)

Place a small information button beside the setting label and render a
structured tooltip next to it. CSS hover and `focus-within` states cover mouse,
keyboard, and touch focus without adding application state.

This provides readable multi-line content and reliable accessible semantics
while keeping the settings panel compact.

### Native `title` attribute

This has the smallest markup change, but browsers control its presentation and
timing. It cannot express the three choices clearly, and keyboard/touch behavior
is inconsistent.

### Permanently visible helper copy

This is highly discoverable, but it expands every settings visit and does not
match the requested tooltip interaction.

## Design

### Markup and interaction

The Tool display row keeps its existing select and wraps the label with a small
tooltip anchor. The anchor contains:

- a `type="button"` information trigger with an inline SVG icon;
- a localized `aria-label`;
- `aria-describedby` pointing to the tooltip;
- a sibling tooltip element with a stable ID and `role="tooltip"`.

The tooltip lists all three choices so users can compare them without changing
the current selection. It appears when the wrapper is hovered or contains
keyboard/touch focus. Moving the pointer away or focusing elsewhere hides it.
No JavaScript listener or mutable tooltip state is added.

The existing settings popover owns the interaction boundary. Clicking the help
control does not close it because the control remains inside `#prefpanel`.
Escape continues to close the entire settings popover through its current
handler.

### Copy

Chinese:

- **隐藏：** 完全不展示工具调用。
- **摘要：** 展示工具名、关键参数和执行状态。
- **完整：** 富文本预览中展示输入与结果摘要；Markdown 和检索类工具仍使用摘要。

English:

- **Hidden:** Omits tool calls completely.
- **Summary:** Shows the tool name, key argument, and execution status.
- **Full:** Shows input and result excerpts in rich previews; Markdown and
  search tools still use summaries.

The label for the information trigger is “工具展示说明” in Chinese and “About
tool display” in English.

### Styling

The trigger is a compact circular control aligned with the Tool display label.
It uses only existing theme tokens for foreground, background, border, hover,
and focus-ring states. The icon is inline SVG; no emoji or remote asset is
introduced.

The tooltip is an opaque paper panel with a strong hairline border, square-card
radius, compact typography, and no backdrop filter or translucent material. It
is positioned toward the left of the trigger so the right-aligned settings
panel does not push it outside the viewport. It uses hard show/hide states and
adds no animation.

### Data flow and errors

The tooltip copy is rendered server-side through the existing i18n dictionaries
and `escapeHtml()`. It has no API, persistence, or failure path. Missing locale
keys retain the existing i18n failure behavior and are covered by locale type
checking and tests.

## Testing

Renderer tests will assert:

- stable trigger and tooltip IDs;
- `type="button"`, localized `aria-label`, `aria-describedby`, and
  `role="tooltip"`;
- exact Chinese and English option explanations;
- CSS contains hover and `focus-within` visibility selectors;
- existing no-backdrop-filter, token-based color, and no-emoji checks continue
  to pass.

The focused renderer tests, full test suite, typecheck, build, and
`git diff --check` form the final verification set.
