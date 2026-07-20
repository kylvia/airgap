<div align="center">

# airgap

**先扫一遍你的 AI 编码会话里漏了多少明文密钥，再把会话搬到任何一台机器上继续——不上云、不要账号。**

[![npm version](https://img.shields.io/npm/v/airgap.svg)](https://www.npmjs.com/package/airgap)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[English](./README.md) · 简体中文

</div>

---

你的 `~/.claude` 和 `~/.codex` 目录里堆满了明文对话记录——而且比你以为的更常见，还夹着你随手粘进去的明文 API key。airgap 是一个纯本地 CLI，干三件事：

- **scan**：扫这两个目录，告诉你到底哪些会话会漏密钥；
- **pack**：把一个会话脱敏打成便携的 `.ccpack`，你想用什么通道发就用什么通道发；
- **open**：在另一台机器上装成新的 Claude Code fork，保留选中的会话树和工具调用；本机 Claude Code 格式兼容时可用 `claude --resume` 续接。

会话内容始终在本机处理。不登录、不上传会话内容。airgap 自身可能访问 npm 官方 Registry，执行下文所述、可以关闭的版本检查。

## 安装

需要 **Node.js 22 或更高版本**。无需全局安装，直接用 `npx airgap <命令>` 即可运行；也可以全局安装 CLI：

```sh
npm install -g airgap
```

`npx` 首次运行时可能从 npm 下载 airgap。交互式运行还可能检查 npm 新版本；确切网络边界和关闭方式见[版本更新提示](#版本更新提示)。需要可复现安装时，用 `npx airgap@<版本>` 或 `npm install -g airgap@<版本>` 固定到你审核过的版本。

当前格式支持：

| 命令 | Claude Code | Codex | 用途 |
| --- | :---: | :---: | --- |
| `scan` | ✓ | ✓ | 查找疑似明文密钥 |
| `pack` | ✓ | ✓ | 脱敏并生成便携的 `.ccpack` |
| `open` | ✓ | ✗ 安装；仅支持 `--print-only` | 校验包；把 Claude 包安装成新的 fork 会话 |
| `show` / `share` | ✓ | ✓ | 在本机导出选中的轮次 |

运行 `npx airgap doctor` 可检查环境，以及当前版本的 `scan` / `pack` / `open` / `show` 支持矩阵。

## 快速开始

```sh
npx airgap scan
```

就这一行。scan 会遍历 `~/.claude` 和 `~/.codex`，把每个 JSONL 会话流式过一遍检测器，按项目打一张表：这些文件一旦被分享或同步出去，会漏什么。

```
airgap scan: scanning ~1,200 sessions...
airgap scan: done in 48.2s

PROJECT                         SESSIONS   CRITICAL  HIGH  MEDIUM  OLDEST
~/work/payments-api             34/51      12        88    140     213d
~/work/infra-terraform          19/22      6         41    77      168d
~/side/scraper                  8/40       3         12    26      95d
~/dotfiles                      2/6        1         4     9       402d
...

⚠ ~680 of ~1,200 sessions contain plaintext secrets that would leak if shared or synced.
```

*（示例输出，数字每台机器都不一样——想看你自己的，跑一下就知道了。）*

想看逐条命中（带掩码预览）：

```sh
npx airgap scan --list          # 每条命中一行，密钥打码
npx airgap scan --json          # 机器可读；密钥原文永远不出进程
npx airgap scan --source claude # 只看某一个来源
```

scan 输出的永远只是每条命中的**掩码预览**，密钥原文不会进 stdout、不会落文件、也不会进 JSON。

## 把会话搬到任何地方 —— pack / open

不是每种环境都能或愿意使用云端交接。API key 用户、Amazon Bedrock / Google Vertex 部署、LLM 网关、零数据保留环境和隔离网络，往往需要一个能走既有审批通道的文件。airgap 提供的就是这条本地文件链路。

**在源机器上** —— 切片、脱敏、打包当前会话：

```sh
npx airgap pack
```

拿到一个 `<项目名>-<yyMMdd>.ccpack`。交互选择每个检测结果是 `redact` 还是 `keep`；`--yes` 则全部脱敏。本地映射表是**原始密钥 → 占位符**，写在 `~/.airgap/maps/`；系统支持时权限为 `0600`，绝不进包。这个文件含有密钥原文，应妥善保护，不再需要时及时删除。

然后通过你信任的通道发送 `.ccpack`——邮件、Slack、AirDrop、U 盘、`scp`。`.ccpack` 是普通 zip，不是加密存储。

**在目标机器上** —— 校验并装成一个新会话：

```sh
npx airgap open payments-api-260703.ccpack
```

open 会按 manifest 校验已声明的文件、打印摘要，并**从头独立重扫每个已声明的内容条目**。扫描干净时（或你显式加 `--accept-risk`），它才把 transcript 装进 `~/.claude`，而且是全新 fork 的会话。之后：

```sh
cd ~/work/payments-api && claude --resume <新的-session-id> --fork-session
```

选中的会话树、tool_use/tool_result 配对、subagent、thinking 的加密签名都会保留在新 fork 中。能否成功续接取决于 Claude Code 的落盘格式，详见[安全与局限](#安全与局限)。

常用参数：

```sh
npx airgap pack --session ab12cd --tail 20   # 指定会话，只带最后 20 个用户轮
npx airgap pack --strip-thinking             # 剥掉 assistant 的 thinking 块
npx airgap open pack.ccpack --print-only     # 只解包 + 列文件，不安装
npx airgap open pack.ccpack --project ~/dst  # 指定装到哪个项目目录
```

## 打开本地选择器 —— `share`

需要挑选几轮对话、实时预览并导出长图 / HTML / Markdown 时，启动本地选择器：

```sh
npm run build && npm link # 在可信本地 checkout 中执行一次
airgap share
```

浏览器会自动打开。服务只绑定 loopback（本机回环地址）；点击**完成关闭**或空闲 10 分钟后退出，airgap 自身不常驻。

Share 支持英文和简体中文，默认跟随系统语言。可用 `--lang` 或 `AIRGAP_LANG` 临时覆盖，也可以从设置面板持久化选择。运行 `airgap doctor` 可查看检测语言和最终语言。

安装[本地助手插件](./plugins/airgap/README.md)后，在 AI 编码对话里也能一步唤起：

- Claude Code：`/airgap:share`
- Codex：`$airgap-share`

想缩短终端命令，可在 shell 配置中加入 `alias ags='airgap share'`。Raycast、Alfred 或 macOS 快捷指令也可以把个人快捷键绑定到同一个 `airgap share` 命令。

## 把几轮对话出成图 —— show

日常场景：你就是想发个片段截图。

```sh
npx airgap show --last 4          # 最后 4 轮 → 单文件 HTML（默认）
npx airgap show --pick --png      # 交互勾选轮次 → 长图 PNG
npx airgap show --md --out clip.md
```

show 把选中的轮次渲染成聊天气泡样式，可出 **Markdown**、**单文件 HTML** 或**长图 PNG**（PNG 需要本机装了 Chrome/Chromium）。它会先对选中内容跑一遍同样的密钥扫描，只要还带命中就要你确认，才让你导出。

## 版本更新提示

在交互式终端中，airgap 通常每 24 小时最多向 npm 官方 Registry（`registry.npmjs.org`）检查一次新版本；如果多个进程同时启动，它们可能在共享缓存更新前各检查一次。请求只包含常规 HTTPS 元数据和当前 airgap 版本，不会携带会话内容、项目名、文件路径或配置值。检查失败会静默跳过，airgap 也绝不会自动安装更新。

发现新版本后，由用户明确执行升级：

```sh
npm install -g airgap@latest # 全局安装
npx airgap@latest            # npx 使用方式
```

可在当前 shell 或 shell 配置中关闭检查：

```sh
export AIRGAP_NO_UPDATE_CHECK=1
```

也可以在 `~/.airgap/config.json` 顶层持久化关闭：

```json
{
  "updateCheck": false
}
```

## 它是怎么工作的

- **本地 JSONL，只读。** 会话是按行分隔的 JSON，claude 在 `~/.claude/projects/<munged-cwd>/<sid>.jsonl`（外加 `subagents/`、`tool-results/` sidecar），codex 在 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。airgap 只读它们；`~/.codex` 从不写入，`~/.claude` 也只有 open 安装新文件时才写，且绝不覆盖已存在文件。
- **一套检测规则，多条独立流程。** scan、pack、show、share 共用同一套密钥检测规则，但各自保留发现、切片和渲染路径。检测器流式读取 JSONL，只遍历字符串**值**；`uuid`、`signature` 等元数据 key 会跳过。
- **安装即 fork。** open 会生成一个全新 `sessionId`，重写 session/cwd 字段，但保留 `uuid`/`parentUuid` 这棵树不动，所以装进来的副本能干净续接，也不会跟现有会话撞车。

## 安全与局限

在你拿一个包去传敏感东西之前，请先读这一节。

- **脱敏是"尽力检测"，不是"保证干净"。** airgap 能找出匹配规则的密钥，但没法承诺一个包一定干净。没见过的 token 格式、被混淆的 key、拆散在多个字段里的密钥，都可能漏掉。你分享出去的东西，残留风险由你自己承担。
- **命中分置信度。** 高置信度规则盯的是真实的凭据前缀（`sk-ant-`、`ghp_`、`AKIA…`、`AIza…`、`sk-proj-`、PEM 块……），这些是该立刻处理的。宽启发式规则（`generic-assignment`、`env-dump`、`bearer-token`、`jwt`）抓的是**疑似**内容、含假阳性——把它们当"这里看一眼"，别当"这是一把活密钥"。
- **包既不加密，也不认证来源。** 拿到包的人都能读取内容。manifest 哈希只能发现已声明条目的变化或损坏；由于 manifest 没有签名，它不能证明发送者身份，也不能阻止别人同时修改内容和哈希。
- **open 在安装前独立扫描。** 它不依赖 manifest 的脱敏自述；只要声明的内容仍命中密钥规则，就默认拒绝安装，除非你加 `--accept-risk`。
- **续接兼容性与版本有关。** 装进 `~/.claude` + resume 的路径对着 **claude 2.1.197/198** 验过。Claude Code 的落盘格式可能漂移；将来某个版本要是 resume 不了装进去的包，用 open 打印出来的兜底命令 `claude --resume <绝对路径> --fork-session`，并且麻烦提个 issue。

## 许可证

[MIT](./LICENSE)
