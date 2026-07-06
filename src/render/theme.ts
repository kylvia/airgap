/**
 * Monad 风格设计 token（取自 demo.md：温暖羊皮纸 editorial 风）。
 * 浅色为 demo.md 的原生主题；深色是为 airgap 配套的暖调深纸变体（demo.md 未提供），
 * 经 prefers-color-scheme 跟随系统，零 JS 切换。
 * 被 CHAT_CSS（导出 HTML / iframe 预览）与 share 外壳共同内联，是唯一色值来源。
 *
 * 核心铁律（见 design.md）：标题用 serif 且永远 weight 400（never bold）；
 * 正文/UI 全用 mono；无阴影，靠 1px 边框 + 撞色面分层；按钮走 100px 胶囊。
 */
export const THEME_CSS = `
  :root {
    color-scheme: light dark;
    --font-serif: "Untitled Serif", ui-serif, Georgia, Cambria, "Times New Roman", "Songti SC", STSong, serif;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "ABC Diatype Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
    --radius-md: 12px;
    --radius-card: 20px;
    --radius-pill: 100px;
    --bg: #f6f3f1;
    --bg-subtle: #efeae6;
    --bg-hover: #e7e1dc;
    --bg-active: #ddd6d0;
    --bg-muted: #cfdaf5;
    --fg: #242424;
    --fg-muted: #4e4d4d;
    --fg-subtle: #797776;
    --border: #cecac8;
    --border-strong: #b3ada8;
    --border-subtle: rgba(36,36,36,0.08);
    --accent: #2b59d1;
    --danger: #c0392b;
    --warning: #d4a72c;
    --warning-fg: #7a5c12;
    --warning-bg: rgba(212,167,44,0.16);
    --btn-primary-bg: #2b59d1;
    --btn-primary-fg: #ffffff;
    --btn-primary-hover: #2247a8;
    --shadow-card: 0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03);
    --focus-ring: 0 0 0 2px #f6f3f1, 0 0 0 4px #2b59d1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #211e1b;
      --bg-subtle: #151311;
      --bg-hover: #2b2723;
      --bg-active: #35302b;
      --bg-muted: #242a3a;
      --fg: #ede8e3;
      --fg-muted: #b3aca5;
      --fg-subtle: #8a847e;
      --border: #3a3634;
      --border-strong: #565049;
      --border-subtle: rgba(255,255,255,0.08);
      --accent: #7d9bf2;
      --danger: #e07a6e;
      --warning: #e0b84a;
      --warning-fg: #e0b84a;
      --warning-bg: rgba(224,184,74,0.14);
      --btn-primary-bg: #3a68e0;
      --btn-primary-fg: #ffffff;
      --btn-primary-hover: #4d78ec;
      --shadow-card: 0 1px 2px rgba(0,0,0,0.35);
      --focus-ring: 0 0 0 2px #211e1b, 0 0 0 4px #7d9bf2;
    }
  }
`;
