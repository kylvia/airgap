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

按钮：主操作一律黑色 pill，白字；次操作 ghost pill。卡片：10px radius、1px hairline border、无 shadow。标题：serif 600；正文/UI：Rubik-like sans；技术内容：mono。share header/footer 是 flat paper bar，不再使用半透明工具栏材质或 CSS backdrop filters。Header 的 sage wash 可以使用普通 `filter: blur(...)` 做柔化；禁止的是依赖背后内容取样的 toolbar 材质，不是所有 blur。

## Implementation Constraints

色值只在 `src/render/theme.ts`；导出的 HTML、iframe preview、share shell 都必须零远程资产：不加载 remote fonts/images/scripts/CSS。`CHAT_CSS` 不使用 CSS backdrop filters；普通 `filter: blur(...)` 可用于 header sage wash。

保留 `src/server/page.ts` 里的 JS/DOM 锚点：IDs `sess`、`sbanner`、`list`、`preview`、`status`、`count`、`all`、`none`、`done`；属性 `data-a`、`data-f`；iframe internals `pv-turn-*`、`pv-sub`；row/list anchors `.row .prev`、`.tag`、`.warn`。

`src/server/page.ts` 的 `buildPreviewShell()` 必须与 `src/render/html.ts` 的 `renderHtml()` 外层 transcript 结构保持同步，避免 share 预览和最终导出长图漂移。

CSS/HTML/JS 写在 template strings 里；避免裸 `${` 和裸反引号。故意插值沿用现有模式：`THEME_CSS`、`chatCss`、`def`、`airgapMark(n)`、`JSON.stringify(...)`。

最小组件清单：`.msg-user`、`.msg-ai`、`.toolcard`、thinking disclosure、warning banner、primary button、ghost button。

验证纪律：文档/视觉约束变更至少跑静态 greps；实现变更还要跑 `npm test` 和 `npm run typecheck`。不要启动或重启用户服务；如需 preview server，先问用户。PNG 默认浅色，深色只在 `prefers-color-scheme: dark` 中。
