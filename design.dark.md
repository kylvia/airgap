---
version: 2
name: airgap
theme: dark
style: Monad — warm dark-parchment variant
description: airgap 视觉规范的深色主题。用与浅色相同的 token 名、不同的值。demo.md 只有浅色，这套暖调深纸是 airgap 为深色系统配套的发挥（羊皮纸 → 深纸），保住 editorial 暖调而非纯黑。浅色主题、完整组件规格与工程约束见 design.md。token 的代码实现在 src/render/theme.ts 的 @media (prefers-color-scheme: dark) 块。
---

> 这是深色主题。浅色主题用相同的 token 名、不同的值，位于 design.md。**注意**：demo.md（Monad）原生只有浅色羊皮纸；本深色是 airgap 的配套发挥，不是参考底稿的一部分。组件语言、Do's and Don'ts、Implementation constraints 全部与 design.md 一致，不再重复。

```yaml
colors:
  # 背景：暖调深纸，非纯黑，保住 editorial 温度；卡片比页面略亮以浮起
  bg: "#211e1b"             # 深纸卡片底（比页面底略亮）
  bg-subtle: "#151311"      # 页面底（比卡片略深，微色差；PNG 不出深色，见下方约束）
  bg-hover: "#2b2723"       # 行 hover / 代码面 / 工具面板底
  bg-active: "#35302b"      # 按下
  bg-muted: "#242a3a"       # 撞色气泡面：带蓝调呼应浅色的 periwinkle
  # 前景
  fg: "#ede8e3"             # 暖白（非纯白）
  fg-muted: "#b3aca5"       # 次要文字
  fg-subtle: "#8a847e"      # 最弱
  # 边框（深色的主要分层手段）
  border: "#3a3634"         # 默认
  border-strong: "#565049"  # 次按钮 / hover 强边框
  border-subtle: "rgba(255,255,255,0.08)"   # 列表行细分隔
  # 功能色
  accent: "#7d9bf2"         # lake blue 暗底提亮：链接 / focus
  danger: "#e07a6e"         # 密钥告警红（提亮暖调）
  warning: "#e0b84a"        # amber
  warning-fg: "#e0b84a"     # amber 文字（深底直接用主色）
  warning-bg: "rgba(224,184,74,0.14)"
  # 主按钮（lake blue 提亮 + 白字，深底对比更足）
  btn-primary-bg: "#3a68e0"
  btn-primary-fg: "#ffffff"
  btn-primary-hover: "#4d78ec"

typography:   # 三级分工（serif/sans/mono）与 design.md 一致，字体不随主题变
  ref: "{design.md#typography}"

spacing:      { ref: "{design.md#spacing}" }
rounded:      { ref: "{design.md#rounded}" }

elevation:
  shadow-card: "0 1px 2px rgba(0,0,0,0.35)"           # 极轻阴影 + 微色差让卡片浮起（同浅色的务实偏离）
  focus-ring: "0 0 0 2px #211e1b, 0 0 0 4px #7d9bf2"  # 焦点环内圈用深纸打底

components:   { ref: "{design.md#components}" }   # 结构同浅色，只是解析出深色值
```

# airgap · Monad Dark

## Colors

深纸而非纯黑：`bg`（`#1b1917`）是带暖调的深褐灰，前景 `fg`（`#ede8e3`）是暖白 —— 保住 Monad 的 editorial 温度，避免掉进冷黑的 SaaS 深色模板。所有面几乎同色，靠 1px `border`（`#3a3634`）勾层次。`bg-muted`（`#242a3a`）是唯一带蓝调的撞色气泡面，呼应浅色的 periwinkle。`accent` 提亮到 `#7d9bf2` 保证黑底对比。

## Elevation & Depth

`shadow-card: none` —— 和浅色一样不用阴影，立体感全来自 `border`。焦点环内圈用深纸 `#1b1917` 打底（浅色是 parchment），外圈提亮蓝。

## Components

主按钮在深色用提亮的 Lake Blue（`#3a68e0`）+ 白字，比浅色更亮以压住深底；靠 `theme.ts` 变量自动切换，CSS 只写一次 `var(--btn-primary-*)`。其余组件（气泡 / 卡片 / 代码 / tag / banner）规格与 design.md 相同 —— serif 标题仍 weight 400、正文仍 mono、卡片仍 Ash 描边无阴影。

## Dark-specific constraint

**PNG 长图永远不出深色。** headless Chrome 截图默认 `prefers-color-scheme: light`，所以 `airgap show --png` 恒用浅色羊皮纸值（发微信的预期）。深色值**必须**只活在 `theme.ts` 的 `@media (prefers-color-scheme: dark)` 块里 —— 一旦写成 `:root` 默认就会污染长图。深色只在 share web UI（`airgap share`）和用户在深色系统下双击打开导出的 `.html` 时生效。

其余 Do's and Don'ts、模板字符串雷区、测试锁定、JS/DOM 锚点、`buildPreviewShell` 同步点 —— 见 design.md，深浅通用。
