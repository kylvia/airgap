/**
 * Dossier style tokens (minimalist-ui direction):
 * warm bone canvas + paper-white cards + off-black actions + muted pastel spot accents.
 * Shared by exported transcript HTML and the local share UI.
 *
 * Rules:
 * - Concrete colors live here; render/page CSS should use var(--x).
 * - Color is scarce: muted pastels carry semantic meaning (ok/err/warn/info), never decoration.
 * - Cards are ultra-flat paper surfaces with hairline borders, no shadows.
 * - Primary actions are off-black square buttons (6px), never pills.
 * - Text is off-black, never pure #000. Dark mode is CSS-only via prefers-color-scheme.
 */
export const THEME_CSS = `
  :root {
    color-scheme: light dark;
    --font-serif: "Newsreader", "Instrument Serif", "Lyon Text", "Playfair Display", Georgia, Cambria, "Songti SC", STSong, serif;
    --font-sans: "SF Pro Display", "SF Pro Text", "Geist Sans", "Switzer", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Helvetica, Arial, sans-serif;
    --font-mono: "Geist Mono", "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace;

    --radius-input: 6px;
    --radius-card: 10px;
    --radius-button: 6px;
    --radius-tag: 9999px;
    /* Compatibility aliases for CSS still referencing older radius names. */
    --radius-sm: var(--radius-input);
    --radius-md: var(--radius-card);
    --radius-pill: var(--radius-tag);
    --shadow-card: none;
    --shadow-hover: 0 2px 8px rgba(0,0,0,0.04);

    --ease: cubic-bezier(0.16, 1, 0.3, 1);
    --dur-1: 120ms;
    --dur-2: 200ms;

    /* Warm monochrome core */
    --color-bone: #fbfbfa;        /* page canvas */
    --color-paper: #ffffff;       /* cards, panels, controls */
    --color-cloud: #f7f6f3;       /* recessed surfaces: code, toolcard head, hover */
    --color-off-black: #1a1a1a;   /* primary text + action fill (never pure #000) */
    --color-charcoal: #2f3437;    /* secondary text */
    --color-graphite: #787774;    /* muted metadata text */

    /* Muted pastel spot accents — semantic only */
    --pastel-green-bg: #edf3ec;
    --pastel-green-fg: #346538;
    --pastel-red-bg: #fdebec;
    --pastel-red-fg: #9f2f2d;
    --pastel-yellow-bg: #fbf3db;
    --pastel-yellow-fg: #956400;
    --pastel-blue-bg: #e1f3fe;
    --pastel-blue-fg: #1f6c9f;

    --bg-subtle: var(--color-bone);
    --bg: var(--color-paper);
    --bg-hover: var(--color-cloud);
    --bg-active: #efeee9;
    --bg-muted: var(--pastel-green-bg);
    --border: #eaeaea;
    --border-strong: rgba(0,0,0,0.14);
    --border-subtle: rgba(0,0,0,0.06);
    --fg: var(--color-off-black);
    --fg-muted: var(--color-charcoal);
    --fg-subtle: var(--color-graphite);
    --accent: var(--pastel-green-fg);       /* ink-weight accent for small marks/dots */
    --accent-wash: var(--pastel-green-bg);  /* faint fill for dots/tags */

    --danger: var(--pastel-red-fg);
    --danger-bg: var(--pastel-red-bg);
    --warning: var(--pastel-yellow-fg);
    --warning-fg: var(--pastel-yellow-fg);
    --warning-bg: var(--pastel-yellow-bg);

    --btn-primary-bg: var(--color-off-black);
    --btn-primary-fg: #ffffff;
    --btn-primary-hover: #333333;
    --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--color-off-black);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bone: #1b1b19;
      --color-paper: #242422;
      --color-cloud: #2c2c29;
      --color-off-black: #ededea;
      --color-charcoal: #b8b6b0;
      --color-graphite: #8a8880;

      --pastel-green-bg: rgba(52,101,56,0.20);
      --pastel-green-fg: #8fc593;
      --pastel-red-bg: rgba(159,47,45,0.22);
      --pastel-red-fg: #e39490;
      --pastel-yellow-bg: rgba(149,100,0,0.20);
      --pastel-yellow-fg: #d9bb70;
      --pastel-blue-bg: rgba(31,108,159,0.20);
      --pastel-blue-fg: #82b8dc;

      --bg-active: #333330;
      --border: rgba(237,237,234,0.13);
      --border-strong: rgba(237,237,234,0.30);
      --border-subtle: rgba(237,237,234,0.07);

      --btn-primary-bg: var(--color-off-black);
      --btn-primary-fg: #1b1b19;
      --btn-primary-hover: #ffffff;
    }
  }
`;
