# Open-source documentation readiness design

## Goal

Make the repository safe and understandable to publish as an open-source security tool. A new user should be able to install and run the supported commands without cloning the repository, understand the exact local/network trust boundary, and find a private vulnerability-reporting path. A contributor should be able to build, test, and change the project without relying on agent-only instructions.

## Scope

This pass changes documentation and documentation-facing CI wording only.

It will:

- add security-reporting and contribution guides;
- make `AGENTS.md` the project instruction source of truth and make `CLAUDE.md` a symlink to it;
- correct installation, compatibility, network, and runtime-version claims;
- turn `CONTRACTS.md` from a temporary builder-agent contract into a current technical reference;
- compress `STATUS.md` into a bounded current-state ledger and remove its embedded NUL byte;
- provide matching English and Simplified Chinese entry points for the desktop and assistant-plugin documentation;
- update the tracked Show HN draft so it cannot be published with placeholders or false trust claims.

It will not:

- change CLI, desktop, plugin, detector, redaction, pack, or update-check behavior;
- add dependencies;
- add governance, funding, support, issue-template, or release-management processes;
- redesign the README or add promotional media;
- claim compatibility that is not exercised by an end-to-end resume test.

## Options considered

### A. Release-blocker patch only

Add `SECURITY.md`, fix the Show HN network claim and placeholders, and remove the NUL byte from `STATUS.md`.

This is fastest, but it leaves the contributor path, stale contracts, split agent instructions, source-only `share` instructions, and language gaps unresolved.

### B. Focused P0/P1 documentation pass

Fix the release blockers and the contributor-facing documentation layer while preserving the current product and repository structure.

This is the selected approach. It addresses the trust and adoption problems found in the review without expanding into community-program infrastructure or product changes.

### C. Full open-source program

In addition to option B, add a code of conduct, governance and support policies, issue/PR templates, changelog automation, compatibility dashboards, screenshots, and a broader README redesign.

This would produce a more mature public project surface, but most of it is not required to make the current release truthful and usable. It is intentionally deferred.

## Documentation structure

### Public user entry points

`README.md` and `README.zh-CN.md` remain the primary product documents. They will:

- use `npx airgap share` as the normal Share entry point;
- keep source build/link instructions in a contributor/development section;
- describe findings as suspected or confidence-graded rather than universally live secrets;
- link directly to security reporting, contributing, issues, desktop documentation, and assistant-plugin documentation;
- describe the update check without implying a completely network-silent executable;
- state that Claude resume compatibility is version-sensitive and manually verified, not guaranteed by the daily canary.

### Security policy

`SECURITY.md` will define:

- which maintained release line accepts reports;
- what should be reported privately rather than in a public issue;
- a private contact path using GitHub private vulnerability reporting;
- the minimum useful report contents, with an explicit prohibition on including live credentials or unredacted transcripts;
- expected acknowledgement and disclosure coordination language without promising an unsupported fixed deadline.

### Contributor guide

`CONTRIBUTING.md` will define:

- prerequisites and clean-install commands;
- build, typecheck, unit-test, and canary commands;
- focused guidance for detection-rule, session-format, rendering, desktop, and plugin changes;
- fixture and secret-safety expectations;
- PR scope and verification expectations;
- where architecture, security, and current-status information lives.

### Project instructions and technical reference

The current `CLAUDE.md` content will move to `AGENTS.md`; `CLAUDE.md` will become a relative symlink to it.

`AGENTS.md` will describe current commands, architecture, invariants, and verification rules in tool-neutral language. It will not claim that the synthetic canary proves compatibility with the newest Claude Code on-disk format.

`CONTRACTS.md` will retain the reverse-engineered format notes, closure rules, detector table, and important exported boundaries. Temporary parallel-agent ownership rules and prohibitions will be removed. All documented CLI options will be synchronized with `airgap <command> --help`.

### Bounded project status

`STATUS.md` will contain only:

- the current branch/phase;
- the current verified product state;
- the immediate documentation-readiness work;
- known live risks and deferred items;
- the exact next verification step.

Completed historical narratives, per-session scratchpad references, and old test counts will be removed; Git history remains the archive.

### Localized subproject entry points

The desktop documentation will use English at `apps/desktop/README.md` and Simplified Chinese at `apps/desktop/README.zh-CN.md`.

The plugin documentation will keep English at `plugins/airgap/README.md` and add Simplified Chinese at `plugins/airgap/README.zh-CN.md`.

Each pair will link to the other language. Requirements will match package metadata, including the desktop requirement of Node.js `>=22.12.0`.

### Launch and CI wording

`docs/launch/show-hn.md` will use the real `kylvia/airgap` URL, include Share in the command surface, distinguish local session processing from the optional npm update check, qualify measured findings, and avoid “full fidelity” or “never touches the network” claims.

`.github/workflows/canary.yml` will keep its behavior unchanged. Comments, job names, and summaries will call it a version sentinel plus synthetic pipeline regression. A green run will not state that the installed latest Claude Code version is format-compatible.

## Validation

The documentation pass is accepted when:

1. all relative Markdown links resolve to existing files and local anchors;
2. documented CLI options agree with fresh output from `node dist/index.js <command> --help`;
3. `npm pack --dry-run --json` contains both root READMEs, `LICENSE`, and the executable distribution;
4. no tracked documentation contains NUL bytes or unresolved `<owner>` placeholders;
5. `AGENTS.md` is a regular tracked file and `CLAUDE.md` is a relative symlink to it;
6. `npm run typecheck`, `npm test`, and `npm run build` pass;
7. `git diff --check` passes and the final commit contains only this documentation-readiness work.

## Deferred work

The following remain separate decisions: `CODE_OF_CONDUCT.md`, `SUPPORT.md`, governance, issue/PR templates, changelog automation, screenshots, badges, funding, and a compatibility dashboard backed by a real logged-in resume test.
