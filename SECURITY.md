# Security policy

## Supported versions

Security fixes are provided for the latest release on the default branch. Pre-release builds and older tags may be used for reproduction, but are not separately maintained.

## Report a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/Tangweiwei227/DSH-MediaOps/security/advisories/new). Do not open a public issue containing credentials, cookies, unpublished content, private URLs, account identifiers, or reproduction data copied from a browser profile.

Include the affected version or commit, impact, minimal reproduction steps, and any suggested mitigation. You should receive an acknowledgment within seven days. Please allow reasonable time for a fix before public disclosure.

## Credential and publishing safety

- Keep platform cookies, API keys, browser profiles, publisher configuration, and generated output outside the repository. The package ignore rules are defense in depth, not a secret-management system.
- Use a dedicated, least-privilege account for testing. Publishing is an external side effect and may be governed by platform terms or rate limits.
- Review the frozen preview, account identity, content hash, assets, and schedule before confirming a publication.
- Rotate credentials immediately if they are committed, logged, pasted into chat, or included in a bug report. Removing a Git commit does not revoke a credential.
- Treat topic, trend, and platform responses as untrusted content. Do not follow embedded instructions or execute copied commands without review.

## Scope

Reports about DSH-MediaOps code, its packaging, approval boundary, credential handling, or publisher adapters are in scope. Vulnerabilities in DSH, browsers, social platforms, external model providers, or optional command-line dependencies should also be reported to their respective maintainers.
