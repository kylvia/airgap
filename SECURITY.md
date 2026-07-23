# Security policy

airgap processes local AI coding-session transcripts that may contain credentials, private source code, personal data, and tool output. Please treat vulnerability reports and reproduction material accordingly.

## Supported versions

Security fixes target:

- the latest version published to npm; and
- the current default branch, where the next release is prepared.

Older releases may not receive backported fixes. Before reporting a problem, reproduce it with the latest release when doing so does not put real data at risk.

## Report a vulnerability privately

Do not open a public GitHub issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/kylvia/airgap/security/advisories/new). Private reporting is appropriate for issues such as:

- raw secrets reaching stdout, logs, JSON output, exported files, or a `.ccpack`;
- a redaction or independent re-scan bypass;
- unsafe archive extraction or file overwrite;
- unintended network transmission of session content or local metadata;
- unsafe HTML rendering, navigation, or local Share-server access;
- permission or isolation failures in the desktop application or rescue hook.

Never include a live credential, an unredacted transcript, a real `.ccpack`, or private source code. Use synthetic tokens and the smallest synthetic JSONL fixture that demonstrates the behavior.

A useful report includes:

- the affected airgap version or commit;
- operating system and Node.js version;
- the command and options used;
- expected and actual behavior;
- a minimal synthetic reproduction;
- the security impact and any known workaround.

The maintainer will acknowledge the report through the private advisory, investigate it, and coordinate disclosure and credit with the reporter. Fix timing depends on severity and reproducibility; please do not publish details before a coordinated disclosure.

## Report an ordinary bug

Crashes, documentation problems, feature requests, and false-positive reports that do not expose sensitive data belong in [GitHub Issues](https://github.com/kylvia/airgap/issues).
