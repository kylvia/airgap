---
version: 3
name: airgap
theme: dark
style: Monad — warm dark-parchment variant
description: airgap 视觉规范的深色主题。用与浅色相同的 token 名、不同的值。demo.md 只有浅色，这套暖调深纸是 airgap 为深色系统配套的发挥（羊皮纸 → 深纸），保住 editorial 暖调而非纯黑。浅色主题、完整组件规格与工程约束见 design.md。token 的代码实现在 src/render/theme.ts 的 @media (prefers-color-scheme: dark) 块。**v3（Geist 纪律）**：深色块只覆写中性灰梯 `--gray-100..800`（深色值，100→800 由暗到亮单调）+ 特殊面 + 功能色；语义别名（bg/fg/border…）与 `--focus-ring` 从灰梯自动派生，不再逐 token 重复。
---

> 这是深色主题。浅色主题用相同的 token 名、不同的值，位于 design.md。**注意**：demo.md（Monad）原生只有浅色羊皮纸；本深色是 airgap 的配套发挥，不是参考底稿的一部分。组件语言、Do's and Don'ts、Implementation constraints 全部与 design.md 一致，不再重复。

```yaml
colors:   # 深色只覆写灰梯 + 特殊面 + 功能色；语义别名（bg/fg/border…）与 focus-ring 自动派生
  # ── 中性灰梯（深色值；100→800 由暗到亮，单调）──暖调深纸，非纯黑，保住 editorial 温度
  gray-100: "#211e1b"       # → --bg：深纸卡片底（比页面底略亮以浮起）
  gray-200: "#2b2723"       # → --bg-hover：行 hover / 代码面 / 工具卡头
  gray-300: "#35302b"       # → --bg-active：按下
  gray-400: "#3a3634"       # → --border：默认（深色主要分层手段）
  gray-500: "#565049"       # → --border-strong：次按钮 / hover 强边框
  gray-600: "#8a847e"       # → --fg-subtle：最弱
  gray-700: "#b3aca5"       # → --fg-muted：次要文字
  gray-800: "#ede8e3"       # → --fg：暖白（非纯白）
  # ── 脱离灰梯的特殊面 ──
  bg-subtle: "#151311"      # 页面底（比 bg 更暗、全场最暗；卡片浮其上；PNG 不出深色，见下方约束）
  bg-muted: "#242a3a"       # 撞色气泡面：带蓝调呼应浅色的 periwinkle
  border-subtle: "rgba(255,255,255,0.08)"   # 列表行细分隔
  # ── 功能色 ──
  accent: "#7d9bf2"         # lake blue 暗底提亮：链接 / focus / mark
  danger: "#e07a6e"         # 密钥告警红 + 工具卡报错描边（提亮暖调）
  warning: "#e0b84a"        # amber
  warning-fg: "#e0b84a"     # amber 文字（深底直接用主色）
  warning-bg: "rgba(224,184,74,0.14)"
  # 主按钮（lake blue 提亮 + 白字，深底对比更足；与提亮的 link-accent 是两个值，故不别名 accent）
  btn-primary-bg: "#3a68e0"
  btn-primary-fg: "#ffffff"
  btn-primary-hover: "#4d78ec"

typography:   # 三级分工（serif/sans/mono）与 design.md 一致，字体不随主题变
  ref: "{design.md#typography}"

spacing:      { ref: "{design.md#spacing}" }
rounded:      { ref: "{design.md#rounded}" }

elevation:
  shadow-card: "0 1px 2px rgba(0,0,0,0.35)"    # 极轻阴影 + 微色差让卡片浮起（同浅色的务实偏离）
  focus-ring:  "自动派生"                         # = 0 0 0 2px var(--bg), 0 0 0 4px var(--accent)，深浅共用一处定义（内圈落到深纸 bg）

components:   { ref: "{design.md#components}" }   # 结构同浅色，只是解析出深色值
```

# airgap · Monad Dark

## Colors

深纸而非纯黑：`bg`（`gray-100` = `#211e1b`）是带暖调的深褐灰，前景 `fg`（`gray-800` = `#ede8e3`）是暖白 —— 保住 Monad 的 editorial 温度，避免掉进冷黑的 SaaS 深色模板。中性灰梯深色下 100→800 由暗到亮，仍单调。所有面几乎同色，靠 1px `border`（`gray-400` = `#3a3634`）勾层次。`bg-muted`（`#242a3a`）是唯一带蓝调的撞色气泡面，呼应浅色的 periwinkle。`accent` 提亮到 `#7d9bf2` 保证黑底对比。

## Elevation & Depth

`shadow-card` 用极轻投影 `0 1px 2px rgba(0,0,0,0.35)` + `bg`/`bg-subtle` 微色差让卡片浮起（同浅色的务实偏离），不用重投影，立体感主要来自 1px `border`。焦点环深浅共用一处 `var(--bg)`/`var(--accent)` 派生：内圈自动落到深纸 `bg`、外圈提亮蓝 accent，`:focus-visible` 才出。

## Components

主按钮在深色用提亮的 Lake Blue（`#3a68e0`）+ 白字，比浅色更亮以压住深底；靠 `theme.ts` 变量自动切换，CSS 只写一次 `var(--btn-primary-*)`。其余组件（气泡 / 卡片 / 代码 / 工具卡 / tag / banner）规格与 design.md 相同 —— serif 标题仍 weight 400、正文仍 mono、卡片仍 Ash 描边 + 极轻阴影。工具卡状态双编码（`✓/✗` + 色）、报错描边转 `danger`，深浅一致。

## Dark-specific constraint

**PNG 长图永远不出深色。** headless Chrome 截图默认 `prefers-color-scheme: light`，所以 `airgap show --png` 恒用浅色羊皮纸值（发微信的预期）。深色值**必须**只活在 `theme.ts` 的 `@media (prefers-color-scheme: dark)` 块里 —— 一旦写成 `:root` 默认就会污染长图。深色只在 share web UI（`airgap share`）和用户在深色系统下双击打开导出的 `.html` 时生效。

其余 Do's and Don'ts、模板字符串雷区、测试锁定、JS/DOM 锚点、`buildPreviewShell` 同步点 —— 见 design.md，深浅通用。
