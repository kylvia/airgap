---
version: 6
name: airgap
theme: light
style: Dossier — minimalist-ui warm document interface for a local security CLI
description: airgap 面向人的 HTML 产出的视觉规范，采用 minimalist-ui 的 Dossier 方向：warm bone canvas、paper-white card、off-black action/text、muted 多色 pastel 语义色。token 的代码实现在 src/render/theme.ts（唯一权威源，改值必改那里并同步本文档）。
---

# airgap · Dossier

airgap 有两处面向人的 HTML 产出：`airgap show` 的单文件 HTML/PNG，以及 `airgap share` 的本地 picker UI。二者共享 `src/render/theme.ts` 的 Dossier token。

核心视觉：`#fbfbfa` warm bone canvas、`#ffffff` paper card、`#1a1a1a` off-black（正文/主操作/hairline，绝不用纯 `#000`）、`#2f3437` charcoal 次级文本、`#787774` graphite metadata。色彩是稀缺资源：muted pastel（green `#346538` / red `#9f2f2d` / yellow `#956400` / blue `#1f6c9f`）只承载语义（ok / err / warn / info），不做装饰、不做大面积填充。

按钮：主操作是 off-black 方按钮（6px 圆角，**不是 pill**），白字；次操作 ghost 方按钮，ink 边框。结构性卡片/toolcard：10px radius、1px `#eaeaea` hairline border、无 shadow。标题：editorial serif 600，tight tracking（-0.02em）；正文/UI：SF Pro / Geist 类 sans（**禁 Inter / Roboto**）；技术内容：mono。页面 bar 是 flat paper，无半透明工具栏材质、无 CSS backdrop filters。

HTML-UI 一律零 emoji：thinking 标记、warning 标记等用 inline SVG（见 `airgapMark` / `thinkingMark` / share 的 `warnMark`）。`renderMarkdown` 的纯文本导出（💭🔧）不属 UI，保留。

正文 markdown 经 **markdown-it** 渲染（`html:false` 转义 raw HTML、图片仅放行 `data:` URI，默认 XSS-safe 且零外链）；GFM 表格/引用/删除线/任务列表/水平线/嵌套列表的样式补在 `CHAT_CSS`，颜色仍走 `var(--x)`。

## Implementation Constraints

色值只在 `src/render/theme.ts`；导出的 HTML、iframe preview、share shell 都必须零远程资产：不加载 remote fonts/images/scripts/CSS，只用系统字体栈。禁 CSS backdrop filters 与半透明 toolbar 材质。

保留 `src/server/page.ts` 里的 JS/DOM 锚点：IDs `sess`、`sbanner`、`list`、`preview`、`status`、`count`、`all`、`none`、`done`、`tools`、`loading`、`limit`；属性 `data-a`、`data-f`；iframe internals `pv-turn-*`、`pv-sub`；row/list anchors `.row .prev`、`.tag`、`.warn`（含 `.wicon` SVG 标记）。loading overlay 是实色 `--bg-subtle` 覆盖 main（非半透明材质），mark 脉动动画尊重 `prefers-reduced-motion`。

`src/server/page.ts` 的 `buildPreviewShell()` 必须与 `src/render/html.ts` 的 `renderHtml()` 外层 transcript 结构保持同步，避免 share 预览和最终导出长图漂移。

CSS/HTML/JS 写在 template strings 里；避免裸 `${` 和裸反引号。故意插值沿用现有模式：`THEME_CSS`、`chatCss`、`def`、`airgapMark(n)`、`WARN_MARK`、`JSON.stringify(...)`。

最小组件清单：transcript 端 `.msg-user`、`.msg-ai`、`.toolcard`、thinking disclosure（inline SVG 标记）；share shell 端 warning banner、primary 方按钮、ghost 方按钮。

验证纪律：文档/视觉约束变更至少跑静态 greps；实现变更还要跑 `npm test` 和 `npm run typecheck`。不要启动或重启用户服务；如需 preview server，先问用户。PNG 默认浅色，深色只在 `prefers-color-scheme: dark` 中。
