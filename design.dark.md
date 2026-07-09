---
version: 5
name: airgap
theme: dark
style: Dossier — warm deep-paper variant
description: airgap Dossier 视觉规范的深色主题。深色主要通过 src/render/theme.ts 覆写 token 值，组件结构与 design.md 一致。
---

# airgap · Dossier Dark

深色保留 Dossier 的 warm paper 气质，不转冷黑 SaaS：canvas `#1b1b19`、paper `#242422`、off-black 文本反相为 `#ededea`、charcoal `#b8b6b0`、graphite `#8a8880`。muted pastel 语义色在深色下降饱和、提亮文字（green `#8fc593` / red `#e39490` / yellow `#d9bb70` / blue `#82b8dc`）。主按钮在深色中用 `--color-off-black`（此时为浅色）作填充，文字落到深 canvas。

深色只通过 `prefers-color-scheme: dark` 生效。主要实现是 `src/render/theme.ts` 的 token 覆写；`--bg` / `--fg` / `--accent` / `--danger` 等语义别名指向被覆写的 `--color-*` / `--pastel-*`，自动跟随，无需在 dark media 内重复定义。组件结构保持与 design.md 对齐。

PNG 长图默认仍是浅色；不要把深色值写进 `:root` 默认值。导出物仍然无半透明工具栏材质、无外链、无 JS 主题切换。
