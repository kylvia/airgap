# airgap 助手插件

[English](./README.md) · 简体中文

这个本地 checkout 插件可以从 Claude Code 或 Codex 直接打开 airgap 的 Share 选择器，不必再去终端复制第二条命令。同一个插件包还为 Claude Code 提供 scan、pack、rescue 命令和 PreCompact 救援 hook。

## 准备本地 CLI

先在可信的本地 checkout 中构建并链接一次 CLI：

```sh
npm run build && npm link
```

这样 Claude Code 与 Codex 都能调用当前 checkout 的 `airgap` 可执行文件。不需要常驻 helper，也不依赖远程插件包。

## 快速唤起

- Claude Code：`/airgap:share`
- Codex：`$airgap-share`
- 终端：`airgap share`

三个入口都会按需启动同一个只绑定 loopback 的选择器。用页面里的 **完成关闭** 按钮退出；空闲 10 分钟也会自动停止进程。airgap 不会常驻。

如需更短的终端入口，可以自行添加别名：

```sh
alias ags='airgap share'
```

也可以把 Raycast、Alfred 或 macOS 快捷指令绑定到 `airgap share`。Airgap 不会安装全局快捷键或常驻 helper。

## 从本地 checkout 安装

把下面的 `/absolute/path/to/airgap` 换成这个仓库的绝对路径。

### Claude Code

```text
/plugin marketplace add /absolute/path/to/airgap
/plugin install airgap@airgap-marketplace
```

执行 `/reload-plugins` 或重启 Claude Code，让命令和 PreCompact hook 生效。

### Codex

```sh
codex plugin marketplace add /absolute/path/to/airgap
codex plugin add airgap@airgap-marketplace
```

新建任务或重启 Codex，让 skill 被发现；之后调用 `$airgap-share`，或者直接要求打开本地 airgap Share 选择器。

## 包含内容

### Claude Code 命令

| 命令 | 作用 |
| --- | --- |
| `/airgap:share` | 直接打开本地选择器。 |
| `/airgap:airgap-share` | 共享 `airgap-share` skill 提供的兼容别名；启动后会提示改用 `/airgap:share`。 |
| `/airgap:airgap-scan` | 扫描 `~/.claude` 和 `~/.codex` 中的明文 API key / 密钥。 |
| `/airgap:airgap-pack` | 脱敏当前会话并打成便携的 `.ccpack`。 |
| `/airgap:airgap-rescue` | 列出并恢复 PreCompact 救援快照。 |

### Codex skill

`$airgap-share` 会启动同一个本地选择器并返回 loopback URL。它的触发范围刻意保持很窄：只用于打开 airgap Share，或分享当前 Claude/Codex 编码会话中选中的轮次。

### Claude PreCompact 救援 hook

Claude Code 在压缩、总结并截断会话前，插件会把完整 transcript 快照保存到 `~/.airgap/rescue/`，只保留最新 20 份。hook 不阻塞压缩，也不增加网络请求；它只复制当前本机会话文件。

快照命名为 `<UTC-timestamp>__<manual|auto>__<session-id>.jsonl`，放在权限 `0700` 的目录中，文件权限为 `0600`，不会离开本机。用 `/airgap:airgap-rescue` 恢复；如果需要分享恢复出来的 transcript，请先用 `airgap pack` 脱敏。

## 要求

- Node.js 22 或更高版本。
- 已在可信本地 checkout 中执行 `npm run build && npm link`。
- Claude Code 支持命令/hook 插件，或 Codex 支持 skill 插件。

## 卸载

Claude Code：

```text
/plugin uninstall airgap@airgap-marketplace
```

Codex：

```sh
codex plugin remove airgap@airgap-marketplace
```

`~/.airgap/rescue/` 中的救援快照属于你的数据，卸载时不会自动删除。
