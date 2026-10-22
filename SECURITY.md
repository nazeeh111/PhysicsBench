# Reporting a security issue

Do not include private media, tokens or other secrets in public issues. Use the repository's GitHub private vulnerability reporting option when available; otherwise open a minimal issue asking for a private reporting channel without exploit-sensitive details.

PhysicsBench processes untrusted files locally. File size/shape bounds, local-only connections and an explicit production asset allowlist reduce exposure; they do not establish universal security. Downloads contain user-selected observations or captured sample windows. The local preview binds to 127.0.0.1, serves verified fixed assets, and refuses arbitrary filesystem paths.

When reporting a problem, include the affected version, browser/OS and a minimal non-sensitive reproducer. No bug bounty or response-time guarantee is offered.
