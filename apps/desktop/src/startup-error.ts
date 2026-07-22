import { THEME_CSS } from "../../../src/render/theme.js";

export const STARTUP_ERROR_RETRY_URL = "airgap-error://retry";
export const STARTUP_ERROR_QUIT_URL = "airgap-error://quit";

export function renderStartupErrorDocument(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Airgap 启动失败</title>
  <style>
    ${THEME_CSS}
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 32px; background: var(--bg-subtle); color: var(--fg); font-family: var(--font-sans); }
    main { width: min(460px, 100%); padding: 32px; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg); }
    h1 { margin: 0 0 12px; font: 600 25px/1.25 var(--font-serif); }
    p { margin: 0; color: var(--fg-muted); font-size: 14px; line-height: 1.7; }
    nav { display: flex; gap: 10px; margin-top: 24px; }
    a { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; padding: 0 18px; border: 1px solid var(--btn-primary-bg); border-radius: var(--radius-button); color: var(--fg); font-size: 13px; font-weight: 600; text-decoration: none; }
    a:first-child { background: var(--btn-primary-bg); color: var(--btn-primary-fg); }
    a:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  </style>
</head>
<body>
  <main>
    <h1>Airgap 暂时无法启动</h1>
    <p>没有读取或发送任何会话内容。你可以重试；如果仍然失败，请退出后重新打开 Airgap。</p>
    <nav aria-label="启动操作">
      <a href="${STARTUP_ERROR_RETRY_URL}">重试</a>
      <a href="${STARTUP_ERROR_QUIT_URL}">退出</a>
    </nav>
  </main>
</body>
</html>`;
}
