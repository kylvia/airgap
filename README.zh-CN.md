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
- **open**：在另一台机器上装回去，直接 `claude --resume` 全保真续接——同一棵树、同样的工具调用。

全程在你本机跑。不登录、不上传、不埋点。

## 快速开始

```sh
npx airgap scan
```

就这一行。scan 会遍历 `~/.claude` 和 `~/.codex`，把每个 JSONL 会话流式过一遍检测器，按项目打一张表：这些文件一旦被分享或同步出去，会漏什么。

```
airgap scan: scanning 1208 sessions...
airgap scan: done in 48.2s

PROJECT                         SESSIONS   CRITICAL  HIGH  MEDIUM  OLDEST
~/work/payments-api             34/51      12        88    140     213d
~/work/infra-terraform          19/22      6         41    77      168d
~/side/scraper                  8/40       3         12    26      95d
~/dotfiles                      2/6        1         4     9       402d
...

⚠ 680 of 1208 sessions contain plaintext secrets that would leak if shared or synced.
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

官方的 `--teleport` / `--cloud` / Remote Control 都要把会话过一遍厂商的云，而且它们明确**把这些人排除在外**：用 API key 的、走 Amazon Bedrock 的、走 Google Vertex 的、走 LLM 网关的、签了零数据保留（ZDR）协议的。只要你是其中之一，那个"上云"按钮对你就是不可用。airgap 给你的是一个文件。

**在源机器上** —— 切片、脱敏、打包当前会话：

```sh
npx airgap pack
```

拿到一个 `<项目名>-<yyMMdd>.ccpack`。写包前，pack 会把检测到的每一处密钥列出来，让你逐条选 `redact`（换成占位符）还是 `keep`（原样保留）；`--yes` 则无人值守全部脱敏。反向映射表（占位符 → 原文）**只**写到 `~/.airgap/maps/`、权限 `0600`，绝不进包。

然后这个 `.ccpack` 想怎么发就怎么发——邮件、Slack、AirDrop、U 盘、`scp`，哪个你信用哪个。

**在目标机器上** —— 校验并装成一个新会话：

```sh
npx airgap open payments-api-260703.ccpack
```

open 会校验压缩包校验和、打印一张信任回执、**把解包出来的内容从头独立重扫一遍**（它绝不相信包自己声称的脱敏结果），只有干净时（或你显式加 `--accept-risk`）才装进 `~/.claude`，而且是全新 fork 的会话。之后：

```sh
cd ~/work/payments-api && claude --resume <新的-session-id> --fork-session
```

整棵树、tool_use/tool_result 配对、subagent、thinking 的加密签名都原样保留，续接起来就跟这会话本来就长在这台机器上一样。

常用参数：

```sh
npx airgap pack --session ab12cd --tail 20   # 指定会话，只带最后 20 个用户轮
npx airgap pack --strip-thinking             # 剥掉 assistant 的 thinking 块
npx airgap open pack.ccpack --print-only     # 只解包 + 列文件，不安装
npx airgap open pack.ccpack --project ~/dst  # 指定装到哪个项目目录
```

## 把几轮对话出成图 —— show

日常场景：你就是想发个片段截图。

```sh
npx airgap show --last 4          # 最后 4 轮 → 单文件 HTML（默认）
npx airgap show --pick --png      # 交互勾选轮次 → 长图 PNG
npx airgap show --md --out clip.md
```

show 把选中的轮次渲染成聊天气泡样式，可出 **Markdown**、**单文件 HTML** 或**长图 PNG**（PNG 需要本机装了 Chrome/Chromium）。它会先对选中内容跑一遍同样的密钥扫描，只要还带命中就要你确认，才让你导出。

## 环境体检 —— doctor

```sh
npx airgap doctor
```

打印本机 `claude` / `codex` 版本，以及各格式的支持矩阵（scan/pack/open/show 各方言支持到什么程度）。

## 它是怎么工作的

- **本地 JSONL，只读。** 会话是按行分隔的 JSON，claude 在 `~/.claude/projects/<munged-cwd>/<sid>.jsonl`（外加 `subagents/`、`tool-results/` sidecar），codex 在 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。airgap 只读它们；`~/.codex` 从不写入，`~/.claude` 也只有 open 安装新文件时才写，且绝不覆盖已存在文件。
- **一个抽取内核，三个出口。** scan、pack、show 共用同一套切片 + 检测引擎。检测器逐行流式解析，只遍历字符串**值**（`uuid`/`signature` 这类元数据 key 跳过），从不动结构完整性。
- **`.ccpack` 就是个普通 zip。** 内部：`manifest.json`、`transcript.jsonl`、`subagents/*`、`tool-results/*`。读取时拒绝绝对路径和 `..`（防 zip-slip）。项目里的绝对路径在打包时被 token 化成 `{{PROJECT_ROOT}}` / `{{HOME}}`，open 时再还原成目标机器的路径。
- **脱敏一致性映射。** 同一个密钥在一个包内永远映射到同一个占位符（`<规则ID>-REDACTED-<随机6位hex>`），主 transcript 和每个 sidecar 都一致。占位符对原始密钥**零信息泄露**，而且逐包不同，所以占位符没法被爆破反推。脱敏后还会重扫一遍，只要还残留密钥，pack 就 fail-closed 直接拒绝写包，而不是把它带出去。
- **安装即 fork。** open 会生成一个全新 `sessionId`，重写 session/cwd 字段，但保留 `uuid`/`parentUuid` 这棵树不动，所以装进来的副本能干净续接，也不会跟现有会话撞车。

## 安全与局限

在你拿一个包去传敏感东西之前，请先读这一节。

- **脱敏是"尽力检测"，不是"保证干净"。** airgap 能找出匹配规则的密钥，但没法承诺一个包一定干净。没见过的 token 格式、被混淆的 key、拆散在多个字段里的密钥，都可能漏掉。你分享出去的东西，残留风险由你自己承担。
- **命中分置信度。** 高置信度规则盯的是真实的凭据前缀（`sk-ant-`、`ghp_`、`AKIA…`、`AIza…`、`sk-proj-`、PEM 块……），这些是该立刻处理的。宽启发式规则（`generic-assignment`、`env-dump`、`bearer-token`、`jwt`）抓的是**疑似**内容、含假阳性——把它们当"这里看一眼"，别当"这是一把活密钥"。
- **open 从不相信包。** 即便 pack 已经脱敏，open 在安装前仍会把每个解包文件独立重扫一遍，只要还含明文密钥，默认拒绝安装，除非你加 `--accept-risk`。
- **安装机制是版本锁定的。** 装进 `~/.claude` + resume 的路径是对着 **claude 2.1.198** 验过的。Claude Code 的落盘格式可能漂移；将来某个版本要是 resume 不了装进去的包，用 open 打印出来的兜底命令 `claude --resume <绝对路径> --fork-session`，并且麻烦提个 issue。
- **`~/.codex` 只读。** airgap 能 scan / pack / show codex 的 rollout，但不往 `~/.codex` 里装——目前 codex 还没有验证过的 resume 注入路径（当前矩阵见 `doctor`）。
- **反向映射只在本地。** 占位符→密钥的映射写在 `~/.airgap/maps/`、权限 `0600`，绝不进 `.ccpack`。

## 这是给谁用的

厂商的云端交接功能把一整批人挡在门外。只要你是下面任何一种，本地文件这条路就是唯一的路：

- 你用**自己的 API key** 调 Claude/Codex，而不是 Pro/Max 登录。
- 你跑在 **Amazon Bedrock** 或 **Google Vertex AI** 上。
- 你走 **LLM 网关 / 代理**（LiteLLM、公司内部中转等）。
- 你签了**零数据保留（ZDR）** 协议，被排除在云同步之外。
- 或者你就是不想让对话离开这台机器——内网隔离、合规环境，或者纯粹是习惯。

airgap 从不问你是谁、你的模型在哪。它读本地文件、写本地文件。这就是它全部的信任模型。

## 许可证

[MIT](./LICENSE)
