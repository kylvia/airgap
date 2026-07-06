/**
 * Monad 风格设计 token（取自 demo.md：温暖羊皮纸 editorial 风），吸收 Geist 工程纪律。
 * 浅色为 demo.md 的原生主题；深色是为 airgap 配套的暖调深纸变体（demo.md 未提供），
 * 经 prefers-color-scheme 跟随系统，零 JS 切换。
 * 被 CHAT_CSS（导出 HTML / iframe 预览）与 share 外壳共同内联，是唯一色值来源。
 *
 * 核心铁律（见 design.md）：标题用 serif 且永远 weight 400（never bold）；正文/UI sans、
 * 技术元素 mono；无重投影，靠 1px 边框 + 微色差分层；按钮走 100px 胶囊。
 *
 * Geist 纪律（本次重构吸收）：
 * - 中性色收敛成单一灰梯 --gray-100..800（意图编码：100–300 面 / 400–500 边框 / 600–800 文字），
 *   浅色 100→800 由亮到暗、深色由暗到亮，两向皆单调；语义面/文字/边框一律别名引灰梯。
 *   bg-subtle（页面底，比 bg 略深）/ bg-muted（撞色气泡）是脱离灰梯的特殊面，单独定义。
 * - 深色块只覆写灰梯 + 特殊面 + 功能色；语义别名与 focus-ring 自动派生，不再重复。
 * - 动效 token 化（--ease/--dur-1/--dur-2）：动效只表达状态变化，micro 120ms / 状态 200ms。
 */
export const THEME_CSS = `
  :root {
    color-scheme: light dark;
    /* 字体（三级分工：serif 标题 / sans 正文·UI / mono 技术元素） */
    --font-serif: "Untitled Serif", ui-serif, Georgia, Cambria, "Times New Roman", "Songti SC", STSong, serif;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "ABC Diatype Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
    /* 圆角（每类组件一档：行内码 / 面板 / 卡片 / 胶囊） */
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-card: 20px;
    --radius-pill: 100px;
    /* 动效（Geist：只表达变化；micro 120ms / 状态 200ms，统一缓动） */
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
    --dur-1: 120ms;
    --dur-2: 200ms;
    /* 中性灰梯（唯一中性色来源）：100–300 面 / 400–500 边框 / 600–800 文字 */
    --gray-100: #f6f3f1;
    --gray-200: #e7e1dc;
    --gray-300: #ddd6d0;
    --gray-400: #cecac8;
    --gray-500: #b3ada8;
    --gray-600: #797776;
    --gray-700: #4e4d4d;
    --gray-800: #242424;
    /* 语义面/文字/边框 —— 中性色一律引灰梯 */
    --bg: var(--gray-100);          /* 卡片底 */
    --bg-hover: var(--gray-200);    /* 行 hover / 代码面 / 工具卡头 */
    --bg-active: var(--gray-300);   /* 按下 */
    --border: var(--gray-400);
    --border-strong: var(--gray-500);
    --fg-subtle: var(--gray-600);
    --fg-muted: var(--gray-700);
    --fg: var(--gray-800);
    /* 脱离灰梯的特殊面：页面底（比 bg 略深，卡片浮其上）+ periwinkle 撞色气泡 + 极淡分隔 */
    --bg-subtle: #efeae6;
    --bg-muted: #cfdaf5;
    --border-subtle: rgba(36,36,36,0.08);
    /* 功能色（accent 是唯一强调；danger/warning 只给告警） */
    --accent: #2b59d1;
    --danger: #c0392b;
    --warning: #d4a72c;
    --warning-fg: #7a5c12;
    --warning-bg: rgba(212,167,44,0.16);
    --btn-primary-bg: #2b59d1;
    --btn-primary-fg: #ffffff;
    --btn-primary-hover: #2247a8;
    /* 深度：极轻阴影 + 焦点环（内圈用 bg 打底、外圈 accent；深浅通用，无需覆写） */
    --shadow-card: 0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03);
    --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --gray-100: #211e1b;
      --gray-200: #2b2723;
      --gray-300: #35302b;
      --gray-400: #3a3634;
      --gray-500: #565049;
      --gray-600: #8a847e;
      --gray-700: #b3aca5;
      --gray-800: #ede8e3;
      --bg-subtle: #151311;
      --bg-muted: #242a3a;
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
    }
  }
`;
