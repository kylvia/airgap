---
version: 4
name: airgap
theme: dark
style: Evergreen — warm deep-paper variant
description: airgap Evergreen 视觉规范的深色主题。深色只覆写 token 值，组件结构与 design.md 一致；代码实现在 src/render/theme.ts 的 @media (prefers-color-scheme: dark) 块。
---

# airgap · Evergreen Dark

深色主题保留 Evergreen 的 warm paper 气质，不转成冷黑 SaaS：canvas `#171711`、card `#232318`、text `#f5f2df`、secondary `#cbc7ad`、sage `#9edaa2`。主按钮在深色中仍使用当前 `--color-ink` 作为浅色填充，文字落到深 canvas。

深色只通过 `prefers-color-scheme: dark` 生效。PNG 长图默认仍是浅色；不要把深色值写进 `:root` 默认值。导出物仍然无半透明工具栏材质、无外链、无 JS 主题切换。
