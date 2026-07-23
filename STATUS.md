# STATUS

## Current phase

Branch: `feat/desktop-share-mvp`

The open-source documentation-readiness pass is implemented and locally verified. The branch is ready for review before broader promotion.

## Verified baseline

- Root npm package: `airgap@0.3.0`, Node.js `>=22`.
- CLI commands present in the built entry point: `scan`, `pack`, `open`, `show`, `share`, and `doctor`.
- Airgap Desktop remains an Apple Silicon macOS developer preview; it is not a signed or notarized public download.
- The assistant plugin is distributed for installation from a trusted local checkout and provides Claude Code commands, a Codex skill, and a Claude PreCompact rescue hook.
- GitHub private vulnerability reporting is enabled for `kylvia/airgap`.
- Verification on 2026-07-23 after rebasing onto `origin/main`: `npm run typecheck` clean; `npm test` 501 passed / 2 skipped; `npm run build` succeeded.
- `npm pack --dry-run --json` for `airgap@0.3.0` contains `LICENSE`, both root READMEs, `dist/index.js`, and `package.json`.

## Current work

- `AGENTS.md` is the shared project-instruction source; `CLAUDE.md` points to it.
- `SECURITY.md` and `CONTRIBUTING.md` provide public security and contributor entry points.
- Root and subproject READMEs now match the published CLI, language, runtime, and network boundaries.
- Technical and launch documents no longer contain stale agent assignments, launch placeholders, or unsupported compatibility claims.
- The remaining action is review of the documentation-only commits on this branch.

## Live risks

- Claude Code session files are an undocumented, version-sensitive format. Resume/install was manually verified against Claude Code 2.1.197/198; the daily canary uses synthetic data and does not prove compatibility with the latest installed version.
- Secret detection and redaction are best-effort. Unknown, obfuscated, or split secrets can pass through.
- `.ccpack` files are neither encrypted nor authenticated.
- The text detector/redactor cannot inspect image pixels; HTML/PNG image export relies on explicit manual review and risk acceptance.
- Interactive CLI runs may contact `registry.npmjs.org` for the optional update check unless disabled.
- Airgap Desktop has no public signing, notarization, or automatic-update channel yet.

## Deferred

- Code of conduct, support and governance policies.
- Issue and pull-request templates.
- Changelog or release-note automation.
- Screenshots, additional badges, funding, and broader README redesign.
- A compatibility dashboard backed by a real logged-in create/resume test.

## Next verification

After any follow-up change:

```sh
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
git diff --check
```

Also verify all tracked Markdown links, NUL-byte absence, CLI-help alignment, and a clean Git worktree.
