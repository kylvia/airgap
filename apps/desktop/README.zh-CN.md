# Airgap Desktop（开发者预览）

[English](./README.md) · 简体中文

Airgap Desktop 是面向非终端用户的 Share 桌面入口。当前版本只做一件事：读取本机 Claude Code / Codex 会话，选择轮次并复制文本或长图。Scan、Pack、Open 暂不进入桌面端。

> 这还是开发者预览，不是面向普通用户发布的安装包。目前没有签名、公证和桌面自动更新，请不要把本地生成的 `.app`、DMG 或 ZIP 当作正式发行版分发。

## 本地运行

当前目标平台是 **Apple Silicon macOS**。需要 Node.js 22.12.0 或更高版本，以及 npm。

在仓库根目录执行：

```sh
npm install
npm run desktop:start
```

`desktop:start` 会先构建主进程，再打开一个 Airgap Share 窗口。它只读取当前用户目录下的 `~/.claude` 和 `~/.codex`，不需要另外启动服务。

关闭窗口会同时关闭桌面进程和它的本地 loopback 服务。命令行的 `airgap share` 仍保持原行为：点击完成或空闲 10 分钟后退出。两者复用同一个 Share 服务和导出逻辑，只是生命周期入口不同，不是两套产品实现。

## 验证

日常单元测试和构建：

```sh
npm run desktop:test
npm run desktop:build
```

Apple Silicon macOS 上的真实 Electron 冒烟测试默认不启动 GUI；显式运行：

```sh
AIRGAP_RUN_ELECTRON_SMOKE=1 npm run desktop:test -- desktop-smoke.test.ts
```

该测试使用临时 HOME 和合成会话，覆盖授权跳转、沙箱隔离、会话切换、原生文本/图片导出、单实例以及关闭后的端口释放，不读取真实会话。

如需验证强制 Retina 缩放下的长图底部完整性：

```sh
AIRGAP_RUN_ELECTRON_INTEGRATION=1 npm run desktop:test -- capture.integration.test.ts
```

## 本地打包

```sh
npm run desktop:make
```

该命令只生成本地 Apple Silicon 构建产物。正式下载版还需要稳定版本号、Developer ID 签名、Apple 公证、发布渠道和签名更新清单。完成这些之前，macOS 无法确认应用发布者，GitHub 下载本身也不能替代系统级的签名与公证校验。

## 安全与更新边界

- 主窗口启用 Chromium sandbox、context isolation 和 web security，并关闭 renderer 的 Node.js 能力。
- Share 服务只绑定 `127.0.0.1`，以随机能力令牌完成一次授权；随后令牌从地址栏移除并放入 HttpOnly cookie。
- 主窗口和图片捕获窗口使用非持久化、相互隔离的 session；权限请求和非预期导航默认拒绝。
- 文本和图片通过 Electron 原生剪贴板导出，不依赖系统安装 Chrome。
- 当前开发者预览没有桌面自动更新。npm CLI 的版本提示策略不变，也不会自动安装更新。
