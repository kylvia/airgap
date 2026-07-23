# Contributing to airgap

Thank you for helping improve airgap. This project reads security-sensitive local transcripts and reverse-engineered session formats, so narrow changes and synthetic test data matter more than broad refactors.

## Prerequisites

- Node.js 22 or newer for CLI work.
- Node.js 22.12.0 or newer for all workspaces, including Airgap Desktop.
- npm, an Apple Silicon Mac for real desktop packaging tests, and a local Chrome/Chromium only for CLI PNG integration checks.

Install the locked dependencies from the repository root:

```sh
npm ci
```

Do not use real `~/.claude` or `~/.codex` transcripts as committed fixtures. Never commit a live credential, private transcript, generated `.ccpack`, redaction map, rescue snapshot, or exported session.

## Build and verify

Run the standard checks before opening a pull request:

```sh
npm run build
npm run typecheck
npm test
```

The synthetic pack/open canary expects a built CLI:

```sh
bash scripts/canary-e2e.sh
```

Focused tests can be run with Vitest:

```sh
npx vitest run test/redact.test.ts
npx vitest run -t "consistency mapping"
```

Desktop checks run from the root workspace:

```sh
npm run desktop:test
npm run desktop:build
```

See [Airgap Desktop](./apps/desktop/README.md) before running GUI smoke tests or packaging commands.

## Change-specific expectations

### Detection and redaction

- Add positive, negative, entropy, and false-positive cases for every detector-rule change.
- Use obviously synthetic token bodies.
- Preserve masked output and the invariant that raw findings never reach stdout or machine-readable scan output.
- Re-run redaction, pack/open, and zip-slip tests when changing shared traversal or replacement behavior.

### Session formats and `.ccpack`

- Read [the technical contracts](./CONTRACTS.md) before changing discovery, slicing, redaction, archive handling, or install behavior.
- Preserve parent/child closure, tool-use/tool-result pairing, sidecars, and metadata-field immutability.
- Treat a green daily canary as a synthetic regression signal, not proof that the latest Claude Code format can resume.
- Document the exact Claude Code or Codex version used for any real-format verification.

### Rendering and the local Share UI

- Treat transcript Markdown and tool output as untrusted input.
- Keep exported HTML and the Share UI free of remote assets.
- Do not weaken raw-HTML escaping, URL validation, image restrictions, loopback binding, or capability-token checks.
- Treat inline image pixels as unscannable: HTML/PNG export must require explicit manual-risk acceptance for structured images and textual `data:image` payloads, `--redact` must not imply pixel redaction, and Markdown must strip supported image bytes.
- Keep CLI `show` and Share image-risk behavior aligned.
- Update rendering and Share regression tests together with visible behavior.

### Desktop and assistant plugins

- Keep the Electron renderer sandboxed and isolated from Node.js.
- Keep desktop and CLI Share behavior on the same server/export implementation.
- Preserve the plugin's on-demand behavior and document any files it retains after uninstall.

## Pull requests

- Keep a pull request focused on one problem.
- Explain the user-visible effect, security boundary, and compatibility risk.
- Add or update tests for behavioral changes.
- Update public documentation and [the current status](./STATUS.md) when the supported surface or known risk changes.
- Include the fresh commands and results used for verification.

Repository-wide agent guidance lives in [AGENTS.md](./AGENTS.md). Durable implementation details live in [CONTRACTS.md](./CONTRACTS.md); active work stays bounded in [STATUS.md](./STATUS.md).

Security vulnerabilities must follow [SECURITY.md](./SECURITY.md), not a public pull request or issue.
