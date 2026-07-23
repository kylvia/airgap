# Open-source Documentation Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make airgap's public documentation truthful, installable, security-reportable, bilingual at each linked subproject entry point, and usable by outside contributors.

**Architecture:** Keep the two root READMEs as user-facing entry points, add focused security and contribution policies, and separate durable project instructions from historical status. Change only documentation and documentation-facing CI wording; preserve all product and workflow behavior.

**Tech Stack:** Markdown, Git symlinks, GitHub Actions YAML, npm/Node.js CLI verification.

---

### Task 1: Establish one project-instruction source of truth

**Files:**
- Create by move: `AGENTS.md`
- Replace with symlink: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Confirm the current structure fails the desired invariant**

Run:

```sh
test -f AGENTS.md
test -L CLAUDE.md
```

Expected: both checks fail because `AGENTS.md` is absent and `CLAUDE.md` is a regular file.

- [ ] **Step 2: Move the existing project knowledge into `AGENTS.md`**

Run:

```sh
git mv CLAUDE.md AGENTS.md
ln -s AGENTS.md CLAUDE.md
```

- [ ] **Step 3: Make the instructions tool-neutral and correct the Canary claim**

Change the title and introduction to describe repository-wide agent guidance rather than Claude-only guidance. Replace the statement that Canary tests the latest Claude Code format with:

```markdown
CI (`.github/workflows/ci.yml`) runs tests on Node 22/24. `canary.yml` records the latest Claude Code version and runs airgap's synthetic pack/open regression daily. It does not create or resume a real session with that version, so a green run is a version sentinel—not proof of on-disk format compatibility.
```

Retain the architecture and safety invariants.

- [ ] **Step 4: Verify the source-of-truth invariant**

Run:

```sh
test -f AGENTS.md
test -L CLAUDE.md
test "$(readlink CLAUDE.md)" = "AGENTS.md"
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the instruction-source change**

```sh
git add AGENTS.md CLAUDE.md
git commit -m "docs: unify project agent instructions"
```

### Task 2: Add security and contribution entry points

**Files:**
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Confirm the public policy files are absent**

Run:

```sh
test -f SECURITY.md
test -f CONTRIBUTING.md
```

Expected: both checks fail before implementation.

- [ ] **Step 2: Create `SECURITY.md`**

Include:

- supported versions: the latest npm release and the current default branch;
- GitHub private vulnerability reporting at `https://github.com/kylvia/airgap/security/advisories/new`;
- explicit instruction not to open a public issue for vulnerabilities;
- explicit instruction never to attach live credentials or unredacted transcripts;
- requested reproduction details using synthetic data;
- coordinated disclosure language without a fixed response-time promise;
- a note that ordinary bugs belong in GitHub Issues.

- [ ] **Step 3: Create `CONTRIBUTING.md`**

Include these exact contributor commands:

```sh
npm ci
npm run build
npm run typecheck
npm test
bash scripts/canary-e2e.sh
```

Document targeted expectations for detector rules, session-format changes, rendering/security changes, desktop changes, and plugin changes. Require synthetic fixtures, narrow PRs, updated documentation, and fresh verification. Link to `AGENTS.md`, `CONTRACTS.md`, `SECURITY.md`, and `STATUS.md`.

- [ ] **Step 4: Correct root README user paths and trust language**

In both root READMEs:

- replace the Share source-checkout installation block with `npx airgap share`;
- add a short “Development and contributing” section containing `npm ci`, build, typecheck, and test commands;
- link to `CONTRIBUTING.md`, `SECURITY.md`, GitHub Issues, desktop docs, and the language-matched plugin docs;
- describe sample scan output as suspected/confidence-graded findings;
- state that session processing stays local while the optional npm update check is the documented network exception;
- keep the existing redaction, unencrypted-pack, and format-drift limitations.

- [ ] **Step 5: Verify the entry points**

Run:

```sh
rg -n "npx airgap share|CONTRIBUTING|SECURITY|github.com/kylvia/airgap/issues" README.md README.zh-CN.md
rg -n "security/advisories/new|live credentials|unredacted" SECURITY.md
rg -n "npm ci|npm run typecheck|npm test|canary-e2e" CONTRIBUTING.md
```

Expected: every required entry point appears.

- [ ] **Step 6: Commit public entry points**

```sh
git add SECURITY.md CONTRIBUTING.md README.md README.zh-CN.md
git commit -m "docs: add security and contribution guides"
```

### Task 3: Refresh technical contracts and bounded status

**Files:**
- Modify: `CONTRACTS.md`
- Replace: `STATUS.md`

- [ ] **Step 1: Record the stale contract and corrupted-status evidence**

Run:

```sh
rg -n "builder agent|airgap scan|airgap open|airgap show|不 .git commit" CONTRACTS.md
perl -ne 'exit 1 if /\x00/' STATUS.md
```

Expected: the contract exposes temporary builder-agent wording and stale options; the Perl command exits 1 because `STATUS.md` contains a NUL byte.

- [ ] **Step 2: Make `CONTRACTS.md` a durable technical reference**

Retitle it as airgap's technical contracts. Remove group ownership, “read-only file,” “do not commit,” “do not install,” and integration-agent delivery instructions.

Synchronize the command surfaces with fresh CLI help:

```text
scan: --json --source --project --list --html --png --out
pack: --last --session --tail --out --yes --no-redact --accept-risk --strip-thinking
open: --project --print-only --accept-risk
show: --last --turns --pick --session --md --html --png --out --tools --redact --yes
share: --session --port --no-open
```

Retain the format notes, closure rules, detector table, redaction invariants, pack safety properties, and test references.

- [ ] **Step 3: Replace `STATUS.md` with a bounded ledger**

Use only these sections:

```markdown
# STATUS
## Current phase
## Verified baseline
## Current work
## Live risks
## Deferred
## Next verification
```

Record the current branch, CLI/Desktop/Plugin status, the documentation-readiness pass, the manually verified Claude format version, the synthetic Canary limitation, and the deferred P2 open-source items. Do not retain historical session narratives or scratchpad paths.

- [ ] **Step 4: Verify the refreshed technical documents**

Run:

```sh
perl -ne 'exit 1 if /\x00/' STATUS.md
rg -n "builder agent|不 .git commit|集成者统一提交" CONTRACTS.md
rg -n -- "--html|--png|--accept-risk|--turns|--tools|--redact|--no-open" CONTRACTS.md
```

Expected: NUL check exits 0; temporary instructions have no matches; current options have matches.

- [ ] **Step 5: Commit the technical-document refresh**

```sh
git add CONTRACTS.md STATUS.md
git commit -m "docs: refresh technical contracts and status"
```

### Task 4: Provide bilingual subproject documentation

**Files:**
- Create from current content: `apps/desktop/README.zh-CN.md`
- Replace: `apps/desktop/README.md`
- Modify: `plugins/airgap/README.md`
- Create: `plugins/airgap/README.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Preserve the current Chinese desktop documentation**

Copy the current desktop content into `apps/desktop/README.zh-CN.md`, add an English-language link at the top, and correct the requirement to Node.js `22.12.0` or newer.

- [ ] **Step 2: Write the English desktop entry point**

Mirror the Chinese document's sections:

- developer-preview warning;
- Apple Silicon macOS and Node.js `>=22.12.0` requirements;
- local run, test, smoke, integration, and packaging commands;
- security boundary and update behavior.

Link to `README.zh-CN.md`.

- [ ] **Step 3: Add the Chinese plugin entry point**

Translate the current plugin document without changing commands or behavior. Cover local CLI preparation, Claude/Codex install commands, provided commands/skill, PreCompact rescue behavior, requirements, uninstall, and retained snapshots. Link both language versions to each other.

- [ ] **Step 4: Route root README links by language**

English root README links to the English desktop/plugin documents. Chinese root README links to `apps/desktop/README.zh-CN.md` and `plugins/airgap/README.zh-CN.md`.

- [ ] **Step 5: Verify versions, commands, and language links**

Run:

```sh
rg -n "22\\.12\\.0|README\\.zh-CN" apps/desktop/README.md
rg -n "22\\.12\\.0|README\\.md" apps/desktop/README.zh-CN.md
rg -n "README\\.zh-CN|airgap:share|airgap-share|PreCompact" plugins/airgap/README.md
rg -n "README\\.md|airgap:share|airgap-share|PreCompact" plugins/airgap/README.zh-CN.md
```

Expected: both language pairs contain matching requirements and command surfaces.

- [ ] **Step 6: Commit the localized documentation**

```sh
git add README.md README.zh-CN.md apps/desktop/README.md apps/desktop/README.zh-CN.md plugins/airgap/README.md plugins/airgap/README.zh-CN.md
git commit -m "docs: add bilingual desktop and plugin guides"
```

### Task 5: Correct launch and Canary wording

**Files:**
- Modify: `docs/launch/show-hn.md`
- Modify: `.github/workflows/canary.yml`

- [ ] **Step 1: Update the Show HN draft**

Replace both `<owner>` URLs with `https://github.com/kylvia/airgap`. Change “never touches the network” to say all session processing is local and the optional update check contacts only the npm registry as documented. Add `share` to the command surface. Replace “full fidelity” with version-sensitive resume language. Keep measured counts explicitly labeled as one machine's suspected/confidence-graded findings.

- [ ] **Step 2: Correct Canary names, comments, and summaries**

Keep triggers and commands unchanged. Rename the job and summary wording from compatibility proof to:

```text
latest claude-code version sentinel + synthetic airgap pipeline
```

On green, report that the synthetic airgap pipeline passed while the installed version was observed. On red, preserve the manual compatibility-check instruction.

- [ ] **Step 3: Verify no false claim or placeholder remains**

Run:

```sh
! rg -n "<owner>|never touches the network|full fidelity|pipeline is compatible" docs/launch/show-hn.md .github/workflows/canary.yml
rg -n "registry\\.npmjs\\.org|synthetic|manually|kylvia/airgap" docs/launch/show-hn.md .github/workflows/canary.yml
```

Expected: prohibited wording has no matches; qualified wording has matches.

- [ ] **Step 4: Commit launch/CI documentation wording**

```sh
git add docs/launch/show-hn.md .github/workflows/canary.yml
git commit -m "docs: qualify launch and canary claims"
```

### Task 6: Run full documentation and project verification

**Files:**
- Modify only if validation exposes a documentation defect.

- [ ] **Step 1: Verify tracked Markdown has no NUL bytes or launch placeholders**

Run:

```sh
git ls-files '*.md' -z | xargs -0 perl -ne 'if (/\x00/) { print \"$ARGV:$.:NUL\n\"; $bad=1 } END { exit($bad ? 1 : 0) }'
! rg -n "<owner>|TBD|TODO" README.md README.zh-CN.md SECURITY.md CONTRIBUTING.md AGENTS.md CONTRACTS.md STATUS.md apps/desktop/*.md plugins/airgap/*.md docs/launch/show-hn.md
```

Expected: both commands exit 0 with no defect output.

- [ ] **Step 2: Verify relative Markdown links**

Run:

```sh
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const missing = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#", 1)[0]);
    if (target && !fs.existsSync(path.resolve(path.dirname(file), target))) missing.push(`${file} -> ${raw}`);
  }
}
if (missing.length) {
  process.stderr.write(`${missing.join("\n")}\n`);
  process.exit(1);
}
'
```

Expected: zero missing targets.

- [ ] **Step 3: Verify documented CLI surfaces**

Run:

```sh
node dist/index.js --help
node dist/index.js scan --help
node dist/index.js pack --help
node dist/index.js open --help
node dist/index.js show --help
node dist/index.js share --help
```

Compare the output against `README.md`, `README.zh-CN.md`, and `CONTRACTS.md`.

- [ ] **Step 4: Verify the package contents**

Run:

```sh
npm pack --dry-run --json
```

Expected: the version declared by `package.json` includes `LICENSE`, both root READMEs, `dist/index.js`, and `package.json`.

- [ ] **Step 5: Run the full project checks**

Run:

```sh
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0 with no test failures or type errors.

- [ ] **Step 6: Verify the final diff and clean commit state**

Run:

```sh
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: no whitespace errors; only intended uncommitted corrections, if any, remain.

- [ ] **Step 7: Commit any validation-only corrections**

If Step 6 shows intended documentation corrections:

```sh
git add AGENTS.md CLAUDE.md SECURITY.md CONTRIBUTING.md README.md README.zh-CN.md CONTRACTS.md STATUS.md apps/desktop/README.md apps/desktop/README.zh-CN.md plugins/airgap/README.md plugins/airgap/README.zh-CN.md docs/launch/show-hn.md .github/workflows/canary.yml
git commit -m "docs: finish open-source documentation readiness"
```

Otherwise, do not create an empty commit.
