---
version: 4
name: airgap
theme: dark
style: Evergreen — warm deep-paper variant
description: airgap Evergreen 视觉规范的深色主题。深色主要通过 src/render/theme.ts 覆写 token 值，组件结构与 design.md 一致；导出 transcript CSS 可在 CHAT_CSS dark media 中保留少量组件级校正。
---

# airgap · Evergreen Dark

深色主题保留 Evergreen 的 warm paper 气质，不转成冷黑 SaaS：canvas `#171711`、card `#232318`、text `#f5f2df`、secondary `#cbc7ad`、sage `#9edaa2`。主按钮在深色中仍使用当前 `--color-ink` 作为浅色填充，文字落到深 canvas。

深色只通过 `prefers-color-scheme: dark` 生效。主要实现是 `src/render/theme.ts` 的 token 覆写；组件结构保持与 design.md 对齐。导出 transcript CSS 可以在 `CHAT_CSS` dark media 中保留少量组件级校正，例如 header sage wash opacity。

PNG 长图默认仍是浅色；不要把深色值写进 `:root` 默认值。导出物仍然无半透明工具栏材质、无外链、无 JS 主题切换。
