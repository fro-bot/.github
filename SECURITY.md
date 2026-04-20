# Security Policy

We appreciate your efforts to responsibly disclose vulnerabilities and help us improve the security of this project.

## Reporting a Vulnerability

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/fro-bot/.github/security/advisories/new) tab.

We will send a response indicating the next steps in handling your report. After the initial reply we will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

Report security bugs in third-party modules to the person or team maintaining the module.

## Supported Versions

This repository is a community-health and automation control plane; it is not a versioned published package. Security updates apply to the current state of `main`.

| Branch | Supported          |
| ------ | ------------------ |
| `main` | :white_check_mark: |

## Automated Security Scanning

- [CodeQL](.github/workflows/codeql-analysis.yaml) — PR + weekly vulnerability analysis
- [Dependency Review](.github/workflows/dependency-review.yaml) — blocks PRs introducing known-vulnerable packages
- [OpenSSF Scorecard](.github/workflows/scorecard.yaml) — weekly supply-chain posture assessment
- [Renovate](.github/workflows/renovate.yaml) — automated dependency updates including security patches

Branch protection, required checks, and secret scanning are configured in [`.github/settings.yml`](.github/settings.yml) and applied via the **Update Repo Settings** workflow.

## OpenSSF Badges

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/fro-bot/.github/badge?style=for-the-badge)](https://securityscorecards.dev/viewer/?uri=github.com/fro-bot/.github "View OpenSSF Scorecard")

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/9834/badge?style=for-the-badge)](https://www.bestpractices.dev/projects/9834 "View OpenSSF Best Practices")
