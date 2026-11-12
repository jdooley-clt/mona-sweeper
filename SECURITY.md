# Security Policy

## Supported Versions

Only the latest `main` branch and live GitHub Pages deployment
(<https://jdooley-clt.github.io/mona-sweeper/>) receive security updates.

| Version | Supported |
| --- | --- |
| `main` (live Pages site) | Yes |
| Older commits / forks | No |

## Scope

Mona Sweeper is a static client-side HTML/CSS/JavaScript game with no backend,
user accounts, analytics, or external runtime network requests. Browser
`localStorage` is used solely to persist high scores, fastest clear times,
theme, and audio preferences locally on your device.

Security issues in scope include:

- Cross-site scripting (XSS) or Content Security Policy bypasses
- Unsafe iframe or cross-origin behavior when embedded in GitHub Arcade
- Supply-chain or workflow vulnerabilities in `.github/workflows/`

## Reporting a Vulnerability

Please report suspected vulnerabilities privately rather than opening a public
issue:

1. Submit a report through
   [GitHub Private Vulnerability Reporting](https://github.com/jdooley-clt/mona-sweeper/security/advisories/new).
2. Include steps to reproduce, affected browser/OS details, and potential impact.

Reports are reviewed promptly and fixes are prepared before public disclosure.
