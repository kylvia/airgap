/**
 * Evergreen style tokens from Refero:
 * linen canvas + bone cards + ink actions + sage botanical accent.
 * Shared by exported transcript HTML and the local share UI.
 *
 * Rules:
 * - Concrete colors live here; render/page CSS should use var(--x).
 * - Sage is an accent wash, never a primary button fill.
 * - Cards are flat paper surfaces with hairline borders, no shadows.
 * - Dark mode is CSS-only via prefers-color-scheme.
 */
export const THEME_CSS = `
  :root {
    color-scheme: light dark;
    --font-serif: "Playfair Display", "DM Serif Display", Georgia, Cambria, "Times New Roman", "Songti SC", STSong, serif;
    --font-sans: "Rubik", "DM Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "ABC Diatype Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace;

    --radius-input: 7px;
    --radius-card: 10px;
    --radius-link: 30px;
    --radius-button: 40.5px;
    --radius-tag: 46px;

    --ease: cubic-bezier(0.4, 0, 0.2, 1);
    --dur-1: 120ms;
    --dur-2: 200ms;

    --color-linen-canvas: #edede2;
    --color-bone-card: #fffff3;
    --color-pure-white: #ffffff;
    --color-ink: #000000;
    --color-charcoal: #333333;
    --color-sage: #beedc0;

    --bg-subtle: var(--color-linen-canvas);
    --bg: var(--color-bone-card);
    --bg-hover: #f4f4e8;
    --bg-active: #e5e5d8;
    --bg-muted: rgba(190,237,192,0.32);
    --border: rgba(0,0,0,0.18);
    --border-strong: var(--color-ink);
    --border-subtle: rgba(0,0,0,0.10);
    --fg: var(--color-ink);
    --fg-muted: var(--color-charcoal);
    --fg-subtle: rgba(51,51,51,0.72);
    --accent: var(--color-sage);

    --danger: #8f2f21;
    --warning: #806416;
    --warning-fg: #5e480f;
    --warning-bg: rgba(128,100,22,0.12);

    --btn-primary-bg: var(--color-ink);
    --btn-primary-fg: var(--color-pure-white);
    --btn-primary-hover: #222222;
    --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--color-ink);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-linen-canvas: #171711;
      --color-bone-card: #232318;
      --color-pure-white: #fffdf0;
      --color-ink: #f5f2df;
      --color-charcoal: #cbc7ad;
      --color-sage: #9edaa2;

      --bg-subtle: var(--color-linen-canvas);
      --bg: var(--color-bone-card);
      --bg-hover: #2e2e20;
      --bg-active: #383827;
      --bg-muted: rgba(158,218,162,0.16);
      --border: rgba(245,242,223,0.18);
      --border-strong: rgba(245,242,223,0.72);
      --border-subtle: rgba(245,242,223,0.10);
      --fg: var(--color-ink);
      --fg-muted: var(--color-charcoal);
      --fg-subtle: rgba(203,199,173,0.72);

      --danger: #e07a6e;
      --warning: #d8bb67;
      --warning-fg: #e5d191;
      --warning-bg: rgba(216,187,103,0.14);
      --btn-primary-bg: var(--color-ink);
      --btn-primary-fg: #171711;
      --btn-primary-hover: #fffdf0;
    }
  }
`;
