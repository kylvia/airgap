# Airgap Update Check Design

**Date:** 2026-07-19
**Status:** Approved in conversation

## Goal

Airgap should tell an interactive user when a newer npm release exists without
silently changing the user's machine. A completed implementation must:

- check npm at most once per 24 hours during ordinary sequential CLI launches;
- show a localized upgrade notice only when `latest` is newer than the running
  package;
- keep JSON, piped, CI, help, and version output stable;
- never upload session, project, path, or configuration data;
- never fail, delay indefinitely, or change a command's exit status because the
  update check failed; and
- provide documented persistent opt-out mechanisms.

## Scope

This work adds a lightweight version check and its cache, localized terminal
messages, configuration parsing, tests, and README documentation. It does not:

- download or install an update;
- prompt for upgrade confirmation;
- infer or modify npm, pnpm, bun, or other package-manager installations;
- add a background process or scheduled task;
- add an update control to the Share page;
- add a third-party dependency; or
- start or restart the user's Share service during verification.

## Chosen Approach

The CLI will query the official npm registry directly. This is preferred over
spawning `npm view`, which is slower and depends on the user's npm executable
and registry configuration. Requiring every invocation to use
`npx airgap@latest` is insufficient because it does not cover globally installed
copies and cannot provide a consistent localized notice.

The endpoint is:

```text
https://registry.npmjs.org/airgap/latest
```

The request includes only ordinary HTTPS metadata and an Airgap version
User-Agent. Eligibility reads the `updateCheck` preference, but the registry
request does not attach session data, filesystem paths, project names, or
configuration contents.

## Eligibility

The check runs by default only when all of these conditions are true:

1. Both stdout and stderr are TTYs.
2. The `CI` environment variable is absent.
3. The argument list does not request `--json`.
4. The invocation is not help, version, or an empty command invocation.
5. `AIRGAP_NO_UPDATE_CHECK` is not `1`.
6. Top-level `updateCheck` in `~/.airgap/config.json` is not `false`.

The environment variable takes precedence over configuration. The narrow
`AIRGAP_NO_UPDATE_CHECK=1` contract avoids surprising interpretations of
arbitrary strings. README examples will cover both persistent opt-outs.

## Components and Data Flow

### Update-check module

A focused module owns eligibility, cache parsing, registry fetching, version
comparison, and notice formatting orchestration. It accepts injectable clock,
home directory, request function, environment, arguments, and TTY state so its
behavior is testable without real network access or a real user profile.

The CLI integration occurs after configuration and locale resolution and before
Commander executes the requested command:

1. Resolve the current locale and create the existing i18n instance.
2. Evaluate eligibility.
3. Read the update-check cache.
4. If the cache is fresh, return immediately without showing a cached notice.
5. If due, attempt the registry request with an 800 ms total timeout.
6. Record the attempt time, even when the request fails, to avoid repeated slow
   attempts while offline.
7. Validate and compare versions.
8. If a newer stable release exists, write one localized notice to stderr.
9. Continue into the requested command with the original exit behavior.

All update-check exceptions are contained inside the module. The top-level CLI
must not treat them as command failures.

### Configuration

`AirgapConfig` gains an optional top-level `updateCheck?: boolean`. Existing
configuration behavior remains unchanged: missing or invalid values fall back
to the enabled default, and unknown keys are ignored on read and preserved by
existing read-modify-write operations.

### Cache

The state truth for throttling is:

```text
~/.airgap/update-check.json
```

The minimal schema is:

```json
{
  "checkedAt": "2026-07-19T12:00:00.000Z",
  "latestVersion": "0.3.0"
}
```

`latestVersion` is omitted when no valid version was received. Missing,
malformed, or future-dated timestamps are treated as stale. Cache writes use a
unique temporary file in `~/.airgap` followed by an atomic rename. Concurrent
processes may perform duplicate checks if they start from the same stale cache,
but they cannot corrupt the cache; cross-process locking is intentionally out of
scope because duplicate startup within the same instant is harmless.

### Version comparison

The running version remains the published package's `package.json` version. The
remote version comes only from the npm `latest` response. A small internal
comparator accepts stable numeric `major.minor.patch` versions and compares each
component numerically. Malformed values and prereleases are ignored. This keeps
the runtime dependency set unchanged; npm's `latest` tag is expected to point to
a stable release.

## User Experience

The notice is informational and never prompts for input. Chinese output is:

```text
Airgap 0.3.0 已发布（当前 0.2.0）
升级全局安装：npm install -g airgap@latest
npx 用户：npx airgap@latest
关闭检查：AIRGAP_NO_UPDATE_CHECK=1
```

The English catalog provides the equivalent message. The notice goes to stderr
before normal command execution. A successful due check can show at most one
notice; a fresh cache suppresses both network access and repeated notices until
the next 24-hour window.

## Failure Behavior

The following conditions are silent and non-fatal:

- DNS, TLS, connection, HTTP, abort, or timeout failure;
- a non-200 response;
- invalid or unexpectedly shaped JSON;
- a missing, malformed, or unsupported version;
- cache read, directory creation, write, rename, or cleanup failure; and
- malformed existing Airgap configuration.

No update-check path may change the requested command's stdout, return value,
exit code, or underlying operation. The only successful feedback channel is the
localized stderr notice for a newer release.

## Documentation

Both READMEs will explain:

- that interactive CLI launches check the official npm registry at most once per
  24 hours;
- exactly what information is and is not sent;
- that no update is installed automatically;
- global and npx upgrade commands; and
- how to disable checks with `AIRGAP_NO_UPDATE_CHECK=1` or top-level
  `"updateCheck": false`.

This disclosure preserves the meaning of “No cloud, no accounts”: session data
remains local, while the optional package-version lookup is explicit.

## Verification

Automated tests must cover:

- a newer major, minor, or patch version producing the localized notice;
- equal, older, malformed, and prerelease versions producing no notice;
- a fresh cache suppressing both the request and the notice;
- a stale or missing cache allowing one request;
- failed requests recording an attempt when the cache is writable;
- the 800 ms timeout path remaining non-fatal;
- malformed cache and configuration input;
- stdout/stderr non-TTY, `CI`, `--json`, help, version, and empty invocations;
- both opt-out mechanisms;
- atomic cache replacement and concurrent-write integrity; and
- top-level CLI integration preserving command output and exit behavior.

Completion requires fresh successful runs of:

```text
npm test
npm run typecheck
npm run build
git diff --check
npm publish --dry-run
```

The final scoped diff review must confirm that no user-owned unrelated files are
staged and that verification did not start or restart a real Share service.
