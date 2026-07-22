# Share 工具展示默认隐藏设计

日期：2026-07-21

## 目标

没有保存工具展示偏好的用户，在桌面版和 CLI `airgap share` 中默认隐藏工具调用。用户仍可在设置中切换为摘要或完整展示。

## 范围

本次只改变 Share 的未配置默认值：

- 桌面版 Share 默认选择“隐藏”。
- 浏览器版 `airgap share` 默认选择“隐藏”。
- 已保存的 `none`、`summary` 或 `full` 偏好继续优先，不被迁移或覆盖。
- 无效的已保存值按现有容错规则回落到新的 Share 默认值“隐藏”。

本次不改变 CLI `airgap show`、通用 HTML/Markdown 渲染器或显式传入 `tools` 参数时的行为。它们继续使用全局 `DEFAULT_TOOL_DISPLAY="summary"`。

## 设计

在 Share 配置层新增专用常量 `DEFAULT_SHARE_TOOL_DISPLAY="none"`。`shareToolDisplay()` 在配置缺失或无效时使用该值；`renderPage()` 的独立默认参数同步改为 `none`，避免直接调用页面渲染器时与真实 Share 服务不一致。

不在首次启动时写入 `~/.airgap/config.json`。只有用户主动修改设置时，才沿用现有原子保存流程写入偏好。

Share 服务启动时继续通过 `shareToolDisplay(loadConfig(...))` 取得生效值，并把它注入页面。页面选择器、会话预览和导出请求继续沿用同一个生效值，不新增状态源。

## 安全边界

“隐藏工具”只改变预览与导出的展示裁剪，不改变秘密检测范围。工具输入、工具输出及摘要中可能出现的密钥仍由现有扫描和脱敏流程检查。

## 测试

按 TDD 增加以下覆盖：

- 配置缺失或 `toolDisplay` 非法时，`shareToolDisplay()` 返回 `none`。
- 已保存 `summary` 或 `full` 时仍返回原值。
- `renderPage()` 未显式传入展示级别时，“隐藏”选项被选中。
- 显式传入 `summary` 时页面仍选择“摘要”。
- 全局 `DEFAULT_TOOL_DISPLAY` 和 CLI `show --help` 的默认值仍为 `summary`。
- 运行全量测试、类型检查、CLI/桌面构建和 npm 发布包检查。

## 非目标

不修改设置文案、选项顺序、配置文件格式、导出 API、桌面生命周期或已保存用户配置。
