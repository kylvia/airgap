---
version: 4
name: airgap
theme: light
style: Monad — editorial tech journal on warm parchment（务实偏离版，吸收 Geist 工程纪律）
description: airgap 面向人的 HTML 产出的视觉规范，Monad 风格（温暖羊皮纸 + editorial serif 标题 + 比例正文 + mono 技术元素）。这是浅色主题；深色主题用相同的 token 名、不同的值，见 design.dark.md。token 的代码实现在 src/render/theme.ts（唯一权威源，改值必改那里并同步本文档）。设计参考底稿见 demo.md。**务实偏离**：忠于 Monad 的羊皮纸/serif/胶囊/Ash 边框语言，但为可读性与成品感做三处偏离——正文改比例字体、卡片加极轻阴影 + 微色差、加克制的装饰渐变与品牌 mark。**Geist 纪律**（v4 吸收，见「Geist discipline」段）：中性色收敛成单一意图编码灰梯、动效/焦点 token 化、状态双编码（颜色 + 字形）、灰色排信息优先级而 accent 只留关键操作。
---

```yaml
colors:
  # ── 中性灰梯（Geist 意图编码，唯一中性色来源；浅色值，深色见 design.dark.md）──
  # 100–300 面 / 400–500 边框 / 600–800 文字。100→800：浅色由亮到暗、深色由暗到亮，两向皆单调。
  # 语义 token（bg/border/fg…）在 theme.ts 里一律 `var(--gray-N)` 别名，改中性色只动灰梯。
  gray-100: "#f6f3f1"        # → --bg：parchment，AI 卡片底
  gray-200: "#e7e1dc"        # → --bg-hover：行 hover / 代码面 / 工具卡头
  gray-300: "#ddd6d0"        # → --bg-active：按下
  gray-400: "#cecac8"        # → --border：ash，默认边框 / 分隔线
  gray-500: "#b3ada8"        # → --border-strong：次按钮 / hover 强边框
  gray-600: "#797776"        # → --fg-subtle：helper / turn-label / footer / thinking / 工具参数
  gray-700: "#4e4d4d"        # → --fg-muted：次要文字
  gray-800: "#242424"        # → --fg：off-black，主文字 / 标题
  # ── 脱离灰梯的特殊面（不参与单调 ramp，单独定义）──
  bg-subtle: "#efeae6"       # 页面底 + PNG 长图底色（比 bg 略深，卡片浮其上；必须不透明）
  bg-muted: "#cfdaf5"        # periwinkle mist：撞色面，专给用户气泡
  border-subtle: "rgba(36,36,36,0.08)"   # 列表行细分隔
  # ── 功能色（accent 是唯一饱和强调；danger/warning 只给告警）──
  accent: "#2b59d1"          # lake blue：只给链接 / focus / 主按钮 / 品牌 mark —— 每屏克制
  danger: "#c0392b"          # 密钥告警红 + 工具卡报错描边（demo.md 无功能红，暖调协调）
  warning: "#d4a72c"         # gold：amber 语义边框
  warning-fg: "#7a5c12"      # amber 文字（浅底可读）
  warning-bg: "rgba(212,167,44,0.16)"
  # 主按钮（lake blue 填充白字，唯一饱和填充）
  btn-primary-bg: "#2b59d1"
  btn-primary-fg: "#ffffff"
  btn-primary-hover: "#2247a8"
  # 装饰渐变（Monad atmospheric wash，只入 header 氛围，不进功能 UI）
  wash: "sky #a0b5eb / mint #a7fccd / coral #ff9473，低透明 + blur(28px)"

typography:
  # 三级分工（务实偏离）：serif 标题 / sans 正文 / mono 技术元素
  font-serif: '"Untitled Serif", ui-serif, Georgia, Cambria, "Times New Roman", "Songti SC", STSong, serif'
  font-sans:  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif'
  font-mono:  '"ABC Diatype Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace'
  title:   { font: "{typography.font-serif}", fontSize: 28px, fontWeight: 400, letterSpacing: -0.02em }  # 聊天页大标题 / share logo(22px)
  heading: { font: "{typography.font-serif}", fontSize: 18-24px, fontWeight: 400, letterSpacing: -0.02em, lineHeight: 1.2 }  # h2 24 / h3 20 / h4 18
  copy:    { font: "{typography.font-sans}", fontSize: 15px, lineHeight: 1.65 }   # 正文（改比例字体提可读）
  bubble:  { font: "{typography.font-sans}", fontSize: 14.5px }                   # 用户气泡
  tool:    { font: "{typography.font-mono}", fontSize: 12px }                     # 工具卡输入 / 行内码 / pre
  label:   { font: "{typography.font-mono}", fontSize: 13px }                     # 按钮 / select
  caption: { font: "{typography.font-mono}", fontSize: 11.5-12px, letterSpacing: 0.04em }  # turn-label / footer

spacing:      # 8px 基准
  base: 8px
  values: [8, 16, 24, 32, 40, 56]

rounded:      # 每类组件一档圆角，never 尖角
  sm: 6px       # 行内码 / 小徽标 / focus 圆角
  md: 12px      # 代码块 / select / 工具卡
  card: 20px    # AI 卡片 / 气泡（≥16px）
  pill: 100px   # 按钮 / tag

motion:       # Geist：动效只表达状态变化，统一缓动；别给静态元素乱加过渡
  ease: "cubic-bezier(0.4, 0, 0.2, 1)"
  dur-1: 120ms  # hover / opacity 微交互
  dur-2: 200ms  # 状态切换

elevation:
  # 务实偏离 demo.md 的 no-shadow 铁律：极轻阴影 + 微色差让卡片浮起
  shadow-card: "0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03)"   # 深色 0 1px 2px rgba(0,0,0,0.35)
  focus-ring: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)"   # 内圈 bg 打底、外圈 accent；深浅通用一次定义，:focus-visible 才出

components:
  brand-mark:                      # airgap 品牌 mark，inline SVG（零外链）
    concept: "两块圆角矩形中间留竖隙，喻 air gap 物理隔离"
    color: "{colors.accent}"
    usage: "聊天页 header 标题前(24px) / footer(13px 弱色) / share logo 前(20px)"
  msg-user-bubble:                 # 用户消息，右对齐；periwinkle 撞色面，无边框
    backgroundColor: "{colors.bg-muted}"
    rounded: "{rounded.card}"
    padding: "12px 18px"
    typography: "{typography.bubble}"
  msg-ai-card:                     # AI 消息，parchment 底 + Ash 描边 + 极轻阴影（比页面浮起）
    backgroundColor: "{colors.bg}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.card}"
    padding: "24px 26px"
    boxShadow: "{elevation.shadow-card}"
  toolcard:                        # 单个工具调用一张执行卡：头(名+状态) + 输入 + 结果摘要（治"工具行堆成日志"）
    backgroundColor: "{colors.bg-subtle}"
    border: "1px solid {colors.border}"        # 报错卡（.toolcard-err）border 换 danger
    rounded: "{rounded.md}"
    head: "工具名(mono, weight 600) + 右侧状态徽标（✓完成 fg-subtle / ✗失败 danger）；底 bg-hover + 下边框"
    in: "完整结构化输入（mono 12px, pre-wrap；单参数直给值 / 多参数逐行 key: value；截断 600 字符）"
    out: "结果摘要（mono 11.5px, fg-subtle；前 6 行 / 400 字符；顶部 dashed 分隔），无结果则省略"
    noEmoji: true                  # 状态用 ✓/✗ 字形 + 颜色双编码（Geist：状态不只靠颜色），绝不用彩色 emoji
  heading-in-card:                 # 卡片内 h2/h3/h4 —— serif 且永远 weight 400
    font: "{typography.font-serif}"
    fontWeight: 400
  code:                            # 行内码 + pre，暖灰面 + Ash 边
    backgroundColor: "{colors.bg-hover}"
    border: "1px solid {colors.border}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  button-primary:                  # lake blue 填充白字胶囊（每屏只一个）
    backgroundColor: "{colors.btn-primary-bg}"
    textColor: "{colors.btn-primary-fg}"
    rounded: "{rounded.pill}"
    height: 36px
  button-ghost:                    # 次按钮：透明 + Ash 描边胶囊
    backgroundColor: transparent
    textColor: "{colors.fg}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.pill}"
    height: 36px
  input:                           # select
    backgroundColor: "{colors.bg}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    height: 34px
  tag:                             # amber 胶囊
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-fg}"
    rounded: "{rounded.pill}"
  banner:                          # 密钥告警横幅
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-fg}"
    borderBottom: "1px solid {colors.warning}"
  empty-state:                     # share 列表空态引导（.list:empty::after）
    text: "从上方选择会话，勾选要分享的轮次开始"
    color: "{colors.fg-subtle}"
```

# airgap · Monad

## Overview

airgap 有两处面向人的 HTML 产出，都遵循本规范：

- **导出聊天 HTML**（`src/render/html.ts` 的 `CHAT_CSS`）—— `airgap show` 生成的单文件，也是 PNG 长图的视觉源头。
- **share web UI**（`src/server/page.ts`）—— `airgap share` 的本地操作界面。

设计语言是 **Monad**：温暖羊皮纸画布（`#f6f3f1`，永不用纯白）、editorial serif 标题、克制的装饰渐变，把界面渲染成"排印成文学杂志的技术手册"。单一 Lake Blue 是唯一强调色。**深色主题跟随系统**（`prefers-color-scheme`，零 JS 切换），深色值见 design.dark.md。

**务实偏离**（为什么不是纯 Monad）：airgap 的内容是高密度工具调用流，纯骨架会"像原型"。所以三处偏离——① 正文用比例 sans（中文大段 mono 难读）；② 卡片加极轻阴影 + 微色差（demo 的 no-shadow 在弱内容上显得没做完）；③ 加装饰渐变晕和品牌 mark（补 Monad 的"血肉"）。标题仍 serif 400、代码/工具/标签仍 mono、按钮仍胶囊、边框仍 Ash。

代码里 token 只存在一处：`src/render/theme.ts`。上面 YAML 是它的人读镜像。**改色只改 theme.ts，别处一律 `var(--x)`。**

## Colors

- **中性灰梯**：所有中性色（面 / 边框 / 文字）收敛成单一意图编码梯 `--gray-100..800`（100–300 面、400–500 边框、600–800 文字），语义 token 一律 `var(--gray-N)` 别名。改中性色只动灰梯一处。
- **背景**：`bg`（卡片，`gray-100`）比 `bg-subtle`（页面底，`#efeae6`）略亮一档 —— 卡片靠这道微色差 + 极轻阴影浮起。`bg-subtle` 脱离灰梯单独定义：它在浅色比 `bg` 略深、在深色是全场最暗（页面沉在卡片之下），无法与灰梯同时单调，所以不进 ramp。`bg-hover`（`gray-200`）给行 hover / 代码面 / 工具卡头；`bg-muted`（periwinkle）是唯一撞色 UI 面，只给用户气泡。
- **前景** `fg` / `fg-muted` / `fg-subtle` 由强到弱。
- **强调**只有一个 `accent`（Lake Blue），给链接 / focus / 主按钮 / 品牌 mark —— **灰色排信息优先级，accent 只留关键操作**（Geist 纪律）。`danger`（含工具卡报错描边）/ `warning` 是告警专用。装饰 pastel（sky/mint/coral）**只入 header 渐变晕，绝不进功能 UI**。

## Typography

不引 webfont（导出 HTML 零外链）。**三级分工**：serif 只给标题、sans 给正文和 UI 文字、mono 给技术元素（代码、工具卡、tag、select、按钮、caption）。serif/mono 的对比仍在，只是正文让位给可读性。**工具卡去 emoji** —— emoji 彩色破坏单色调、是原型感来源。字重克制：serif 标题恒 400、正文 400、`strong`/工具名 600、按钮 500 —— 语义分工，别再引第四档。

## Layout

间距 8px 基准。聊天页 `.wrap { max-width: 700px }` 决定 PNG 长图宽度，别改全宽。

## Elevation & Depth

**极轻阴影 + 微色差**（务实偏离 demo 的 no-shadow）：`shadow-card` 浅色 `0 1px 2px rgba(0,0,0,0.05)`、深色 `0 1px 2px rgba(0,0,0,0.35)`，配 `bg`/`bg-subtle` 色差让 `.msg-ai` 卡片有边界。仍不用重投影。

## Motion & Focus

- **动效只表达变化**（Geist）：过渡走 `--dur-1`（120ms，hover/opacity）/ `--dur-2`（200ms，状态切换）+ `--ease`，别给静态元素乱加过渡、别超 300ms、代码里不裸写 `.15s`。
- **焦点永远可见**：一切可键盘聚焦元素（select / button / 链接 / `summary` / bar 链接）在 `:focus-visible` 出 `--focus-ring`（内圈 `bg` 打底、外圈 `accent`，深浅通用），`outline:none` 后必须补 ring。

## Geist discipline（v4 吸收，务必守）

从 Vercel Geist 嫁接进来的四条工程纪律，都不改 Monad 长相、只提工程严谨度：

1. **中性色单一灰梯**：`--gray-100..800` 意图编码（100–300 面 / 400–500 边框 / 600–800 文字），语义 token 全别名引梯；`bg-subtle`/`bg-muted` 是脱离梯的特殊面。改中性色只动灰梯一处。
2. **灰色排优先级、accent 只留关键**：信息层级靠灰梯深浅拉开，`accent` 每屏克制，只给链接 / focus / 主按钮 / mark。
3. **状态双编码**：成功 / 失败 / 告警绝不只靠颜色 —— 工具卡状态用 `✓/✗` 字形 + 色，告警横幅 / 行用 `⚠` + 色，错误状态带文字标签（色盲 + 单色 PNG 截图下仍可读）。
4. **一档圆角、克制字重**：每类组件固定一档 `--radius-*`（never 裸写 px），字重只用 400/500/600 语义三档。

## Shapes

`sm 6px`（行内码 / focus 圆角）、`md 12px`（代码 / select / 工具卡）、`card 20px`（卡片 / 气泡）、`pill 100px`（按钮 / tag）。每类组件固定一档，never 尖角、never 裸写 `px`（走 `--radius-*`）。

## Components

- **用户气泡 vs AI 卡片**：气泡 periwinkle 撞色面、卡片 parchment Ash 描边 + 极轻阴影。
- **工具执行卡**（重点）：每个工具调用渲染成一张 `.toolcard` —— 头部（`.tool-name` 加重 + 右侧 `.tool-status` ✓完成/✗失败）、`.toolcard-in`（完整结构化输入）、`.toolcard-out`（结果摘要，无结果则省略）。报错卡（`.toolcard-err`）描边转 `danger`。状态**双编码**（字形 + 颜色，Geist 纪律），无 emoji。这是治"工具行堆成日志"、且让「AI 做了什么 + 结果」一眼可读的核心。
- **标题永远 serif 400**：卡片内 h2/h3/h4 全 serif weight 400，绝不 bold。
- **代码**：行内码和 `pre` 走 `bg-hover` 暖灰面 + Ash 边。
- **按钮**：主 `button-primary`（Lake Blue 胶囊）、次 `button-ghost`（描边胶囊），100px pill，加 `transition` 微交互。
- **品牌 mark**：inline SVG（两块留隙喻 air gap），accent 色，用于 header/footer/logo。
- **空态引导**：share 列表空时 `.list:empty::after` 显引导文字。
- **告警**：`tag`/`banner` amber，`.warn`/`.status.err` danger。
- **装饰渐变**：header 顶一层重模糊、低透明的 pastel wash 营造氛围，深色降透明度。
- **预览衔接**：share `.right`/`iframe` 用 `bg-subtle`，与 iframe 内聊天页 `body` 同 token。

## Do's and Don'ts

- **Do** 色值只写 `theme.ts`，别处 `var(--x)`。**Don't** 写裸十六进制。
- **Do** 标题 serif 400。**Don't** 让标题 bold/600+。
- **Do** 正文/UI 用 sans、代码/工具/标签用 mono。**Don't** 让正文回到 mono（中文难读），或给正文换衬线。
- **Do** parchment `#f6f3f1` 作卡片、`#efeae6` 作页面底。**Don't** 用纯白，或让两者同色（卡片浮不起来）。
- **Do** Lake Blue 只留主操作/强调。**Don't** 引入第四种 UI 强调色；pastel 只进 header 渐变。
- **Do** 卡片极轻阴影 + 微色差、按钮胶囊。**Don't** 用重投影或尖角。
- **Do** 每个工具调用成一张带输入/结果的执行卡、状态用 ✓/✗ 字形 + 颜色双编码。**Don't** 让工具调用回到一行一个裸 emoji 灰行（那就是"原型感"根因），或只靠颜色区分成功/失败。

## Agent Prompt Guide（快速喂 agent）

要 AI agent 产出 airgap 风格 UI 时，把下面这段作为约束贴给它：

> 暖羊皮纸底（`#f6f3f1` 卡片 / `#efeae6` 页面，**永不纯白**）；深色跟随系统、用暖深纸（`#211e1b`）非纯黑。标题用 serif 且**永远 weight 400**（never bold），正文 / UI 用 sans，代码 / 工具 / 标签 / 按钮用 mono。唯一强调色 Lake Blue `#2b59d1`，只给链接 / 焦点 / 主按钮 / 品牌 mark；**灰色排信息优先级**。中性色一律取自灰梯 `--gray-100..800`，别裸写 hex。圆角只用 6 / 12 / 20 / 100px 四档、never 尖角；按钮走 100px 胶囊；无重投影，靠 1px 边框 + 极轻阴影分层。**状态双编码**（颜色 + `✓/✗/⚠` 字形）；工具调用渲染成卡片（名 + 状态 + 输入 + 结果摘要），去 emoji。动效只表达变化（≤200ms、统一缓动）；焦点永远出 `:focus-visible` ring。

## Implementation constraints（airgap 特有，改前必看）

- **PNG 恒浅色**：headless Chrome 默认 light，长图永远羊皮纸浅色。深色值**必须**待在 dark 媒体查询里；装饰渐变的深色降透明度也写在 `CHAT_CSS` 的 `@media dark` 里。
- **iframe 继承媒体查询**：srcdoc 预览自动跟随宿主浅深，无需 postMessage。
- **模板字符串雷区**：CSS/JS 写在模板字符串里，不许出现裸 `${` 和裸反引号。故意插值只有 `${THEME_CSS}` / `${chatCss}` / `${def}` / `${airgapMark(n)}` / `${JSON.stringify(...)}`。
- **测试锁定**（`test/render.test.ts`）：class `msg-user`/`msg-ai`/`thinking`、工具卡 `class="toolcard"` + `tool-name`/`tool-status ok`/`toolcard-in`/`toolcard-out`、文案「导出自本地会话 · Generated by airgap」和「—— 第 N 轮 ——」、md→标签映射、断言存在 `prefers-color-scheme: dark`/`--bg:`/`--font-serif`/`--font-sans`/`#f6f3f1`、不含旧绿 `#95ec69`。
- **JS/DOM 锚点**（`page.ts`，别动）：id `sess/sbanner/list/preview/status/count/all/none/done`；iframe 内 `pv-turn-*`/`pv-sub`；`.row .prev`/`.tag`/`.warn`；`data-a`/`data-f`。
- **`buildPreviewShell()`**（`page.ts`）手写复刻 `renderHtml` 外层 DOM（`.wrap`/`.header`/`.title`/`.footer` + mark + 署名，mark 经前端常量 `MARK_H`/`MARK_F` 注入）。改 `renderHtml` 的 header/footer 结构必须同步这里，否则预览 ≠ 导出图。

验证：`npm test` + `npm run typecheck` 全绿 → `npm run dev -- show --last 6 --png`（挑工具密集会话）确认工具成卡（名+状态+输入+结果）、卡片浮起、正文可读、长图浅色 700px → `npm run dev -- share` 切浅/深看空态/hover/mark/预览衔接 → 导出 `.html` 深色下双击确认暖深纸、Network 零外链。
