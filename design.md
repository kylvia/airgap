---
version: 5
name: airgap
theme: light
style: Evergreen — sunlit greenhouse on linen paper adapted for a local security CLI
description: airgap 面向人的 HTML 产出的视觉规范，采用 Refero Evergreen：linen canvas、bone card、black ink、sage mint botanical accent。token 的代码实现在 src/render/theme.ts（唯一权威源，改值必改那里并同步本文档）。
---

# airgap · Evergreen

airgap 有两处面向人的 HTML 产出：`airgap show` 的单文件 HTML/PNG，以及 `airgap share` 的本地 picker UI。二者共享 `src/render/theme.ts` 的 Evergreen token。

核心视觉：`#edede2` linen canvas、`#fffff3` bone card、`#000000` ink action/text/border、`#333333` charcoal secondary text、`#beedc0` sage mint accent wash。Sage 只做头像/标记/轻 wash，不做按钮填充、链接色或大背景。

按钮：主操作一律黑色 pill，白字；次操作 ghost pill。卡片：10px radius、1px hairline border、无 shadow。标题：serif 600；正文/UI：Rubik-like sans；技术内容：mono。share header/footer 是 flat paper bar，不再使用半透明工具栏材质或 CSS 背景滤镜。

硬约束：色值只在 `theme.ts`；导出 HTML 零外链；`CHAT_CSS` 不使用背景模糊滤镜；保留 `page.ts` 里所有 JS/DOM 锚点；PNG 默认浅色，深色只在 `prefers-color-scheme: dark` 中。
