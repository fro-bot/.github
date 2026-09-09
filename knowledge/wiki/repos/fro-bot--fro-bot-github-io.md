---
type: repo
title: fro-bot/fro-bot.github.io
created: 2026-05-07
updated: 2026-09-09
sources:
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-05-07
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-05-24
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-05
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-15
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-26
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-07-25
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-08-10
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-09-09
tags:
  - github-pages
  - custom-domain
  - fro-bot-org
  - infrastructure
  - tls
  - dns
  - https-enforcement
related:
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
node_id: R_kgDORLxXng
---

# fro-bot/fro-bot.github.io

Org-level GitHub Pages custom domain holder for the `fro-bot` organization. Serves the `fro.bot` domain.

## Overview

| Field           | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Full name       | `fro-bot/fro-bot.github.io`                             |
| Description     | "Custom domain pages for @fro-bot"                      |
| Visibility      | Public                                                  |
| Created         | 2026-02-09                                              |
| Default branch  | `main`                                                  |
| Language        | None (static content only)                              |
| License         | None                                                    |
| Has Pages       | Yes                                                     |
| Custom domain   | `fro.bot` (CNAME)                                       |
| HTTPS           | Let's Encrypt cert for `fro.bot` + `www.fro.bot`, **issued 2026-08-08, expires 2026-11-06** (measured live 2026-09-09) |
| HTTPS enforced  | No — confirmed behaviorally 2026-09-09 (see [Live Domain Probes](#live-domain-probes-2026-09-09)) |
| Build type      | Legacy (serves from `main` branch `/` path)             |
| Size            | 0 KB (single CNAME file)                                |
| Topics          | None                                                    |
| Archived        | No                                                      |

## Repository Contents

The entire repository consists of a single file:

- **`CNAME`** — contains `fro.bot`, instructing GitHub Pages to serve this org site at the custom domain

There is no README, no `.github` directory, no workflows, no application code, and no configuration files beyond CNAME.

## Commit History

Single commit on `main`:

| SHA       | Message       | Author   | Date       |
| --------- | ------------- | -------- | ---------- |
| `3e44653` | Create CNAME  | Fro Bot  | 2026-02-09 |

## GitHub Pages Configuration

- **Source:** `main` branch, root path (`/`)
- **Build type:** Legacy (no GitHub Actions deployment)
- **Custom domain:** `fro.bot`
- **TLS certificate:** covers `fro.bot` and `www.fro.bot`. **Superseded 2026-09-09:** direct TLS handshake reads `notBefore = 2026-08-08 04:59:41 UTC`, `notAfter = 2026-11-06 04:59:40 UTC`, issuer `C=US, O=Let's Encrypt, CN=YR1`, SAN `DNS:fro.bot, DNS:www.fro.bot`. The **2026-09-07** expiry recorded from 2026-06-15 through 2026-08-10 is retired — auto-renewal happened on 2026-08-08, two days _before_ the 2026-08-10 survey flagged it as "~28 days out, inside the renewal window." See [Carried Metadata vs. Measured Ground Truth](#carried-metadata-vs-measured-ground-truth-2026-09-09).
- **HTTPS enforcement:** Not enabled. Confirmed live 2026-09-09, not inferred from API state: `http://fro.bot/` is served in cleartext with no upgrade, no `Location:` header, and **no `Strict-Transport-Security` header appears on any response** from the apex or from `fro.bot/systematic/`. This has a demonstrated consequence — see the downgrade chain below.
- **Custom 404:** Not configured. `https://fro.bot/` returns GitHub's stock 404 (9,379 bytes, `etag "6a99a332-24a3"`, CSP `default-src 'none'`) because the repo holds no `index.html`. The org site's entire served behavior is: hold the namespace, redirect `www`, 404 the root.
- **Domain verification:** `protected_domain_state: unverified` (observed 2026-06-15) — the custom domain is not org-verified, leaving the namespace eligible for takeover if the repo's CNAME is ever removed. **Mechanism identified 2026-09-09:** `dig _github-pages-challenge-fro-bot.fro.bot TXT` returns **no record**. The unverified state is not a UI step someone skipped downstream; the required DNS challenge record was never published. Verification is a two-part fix (create the TXT record at the authoritative nameservers, then confirm in org settings), not a one-click toggle.

## Live Domain Probes (2026-09-09)

The 2026-07-25 and 2026-08-10 surveys both ran without a GitHub API token and carried Pages/TLS/domain state forward unverified. This survey also had no token — and established the same facts anyway, from the network side. Every value in this section is a direct measurement, not an API read.

### The canonical redirect drops TLS

```text
https://fro-bot.github.io/  →  301  Location: http://fro.bot/      ← scheme downgraded
http://fro.bot/             →  404  (cleartext, no upgrade, no HSTS)

https://www.fro.bot/        →  301  Location: https://fro.bot/     ← scheme preserved
https://fro.bot/            →  404
```

GitHub Pages emits the canonical-domain redirect using the scheme implied by the repo's HTTPS-enforcement setting. With enforcement off, anyone who reaches the org's `github.io` URL over TLS is redirected **out of TLS** onto the vanity domain, and the cleartext request that follows is never upgraded. The `www` → apex redirect keeps HTTPS; the `github.io` → apex redirect does not. Same domain, same repo, two different scheme outcomes from one unset toggle.

The payload at the end of the chain is a 404 page, so the exposure today is metadata only — but it is a live, reproducible downgrade on the org's own namespace, and it will silently apply to whatever content ever lands at the apex. This upgrades the standing "enable HTTPS enforcement" recommendation from a checklist item to a defect with a reproduction.

### DNS

| Record | Value | Note |
| ------ | ----- | ---- |
| `A` | `185.199.108.153`, `.109`, `.110`, `.111` | The four GitHub Pages anycast addresses — correct |
| `AAAA` | **none** | **IPv6-only clients cannot reach `fro.bot`.** Verified asymmetry: `fro-bot.github.io` resolves to `2606:50c0:800{0,1,2,3}::153`, so the Pages edge is dual-stack — the custom domain simply never published the AAAA half |
| `CNAME` (apex) | none | Apex uses A records, as GitHub documents |
| `www` | `fro-bot.github.io.` | Correct; the only reason the `www` redirect works |
| `CAA` | **none** | Any CA may issue for `fro.bot`. No issuance constraint on a domain whose GitHub-side ownership is also unverified |
| `NS` | `ns1.box.heatvision.co.`, `ns2.box.heatvision.co.` | Self-hosted authoritative DNS — not a managed provider. Relevant to the fix path for the missing challenge TXT record |
| `MX` | `10 box.heatvision.co.` | `fro.bot` is a working mail domain, not just a Pages alias |
| `TXT` (SPF) | `v=spf1 mx -all` | Coherent with the single MX; hard-fails everything else |
| `TXT` (`_dmarc`) | `v=DMARC1; p=quarantine;` | No `rua`/`ruf` reporting addresses — policy enforced, failures unobserved |
| `TXT` (`_github-pages-challenge-fro-bot`) | **none** | Root cause of the carried `unverified` state |

Mail matters here because the domain is not decorative: the published `@fro.bot/systematic` package manifest carries an `@fro.bot` author address, so the same namespace this single-`CNAME` repo holds is also an identity surface. A domain that signs package authorship deserves the CAA record and the verification TXT it currently lacks.

### Carried Metadata vs. Measured Ground Truth (2026-09-09)

The TLS expiry is the cleanest instance of a survey failure mode this page has been reproducing for three cycles:

- 2026-06-26 — cert expiry read from the API as **2026-09-07**. Last time it was fetched.
- 2026-07-25 — no token. Value carried forward. Flagged "~44 days out."
- 2026-08-10 — no token. Value carried forward again. Flagged "~28 days out, **inside the renewal window**," with an explicit escalation trigger: _"if a future token-bearing survey still shows 2026-09-07 past that point, escalate."_
- **Ground truth:** the certificate was reissued on **2026-08-08**, two days before that survey ran. The window it warned about had already closed.

The escalation was conditioned on a token the surveys did not have, for a fact that required no token at all — one TLS handshake answers it. Three cycles of "carried forward, not re-confirmed" is not the same as three cycles of "could not be measured," and the page did not distinguish them. Two rules generalized to [[github-pages]]:

- **Carrying a value forward is a decision to stop measuring it.** Label it that way, and each carry should ask what the cheapest independent channel is — not just whether the previous channel is available.
- **Prefer the channel that observes the artifact over the one that reports on it.** The API describes GitHub's intended Pages configuration; the handshake, the redirect chain, and `dig` observe what the internet actually receives. Here the observing channels were both more available and more current.

## Domain Usage

The `fro.bot` domain is the vanity namespace for the Fro Bot organization:

- **`fro.bot/systematic`** — Starlight/Astro documentation site for [[marcusrbrown--systematic]] (`@fro.bot/systematic` npm package), deployed from [[fro-bot--systematic]]
- **`cliproxy.fro.bot`** — CLIProxyAPI endpoint managed by [[marcusrbrown--infra]] (separate DNS, not served by this repo)

**Project-path probe (2026-09-09).** `fro.bot/systematic/` is the **only** live project path under the org domain: `/dashboard/`, `/agent/`, `/space-bus/`, and `/schemas/` all return 404. The org's other public repos with Pages surfaces are not published under the vanity namespace, so the apex's 404 is the site — the domain is a one-path host plus a redirect.

**Incidental cross-repo observation.** `https://fro.bot/systematic/` returned 200 with `last-modified: 2026-09-08 04:17:27 UTC`, and its OCX registry at `/systematic/index.json` reads **`version 3.16.5`** with **73 components** (23,900 bytes; top-level keys `name`/`namespace`/`version`/`author`/`components`). Two things this corroborates for [[fro-bot--systematic]]: the release-gated deploy is live and recent (the 09-04 "drought" reading remains correctly diagnosed as compositional), and **components are flat at 73 for a fifth consecutive observation** while the version moved 3.15.0 (09-04) → 3.16.1 (09-05, source-side) → **3.16.5** — reinforcing that component count and release cadence are independent measurements on this target.

**Unresolved.** The wiki records that [[fro-bot--systematic]] hosts a pinned JSON Schema at `/schemas/v<major>/`. Probes of `fro.bot/schemas/`, `fro.bot/systematic/schemas/`, `fro.bot/systematic/schemas/v3/`, and `…/systematic.json` all returned 404, and the docs sitemap contains a single `<loc>`. These were guessed paths, so this is **not** a claim that the schema is unpublished — only that its serving path is not where a reader of that description would look. A source-side survey of [[fro-bot--systematic]] should record the exact URL.

## Collaborators

- `fro-bot` — sole collaborator

## Open Issues

| #  | Title                                                            | Opened     |
| -- | ---------------------------------------------------------------- | ---------- |
| 1  | Enable code scanning (CodeQL / Scorecard) for coverage parity    | 2026-03-09 |

## Branch Protection

No branch protection configured on `main`. This is consistent with the repo's role as a static domain holder, but inconsistent with the ecosystem pattern where repos extend `fro-bot/.github:common-settings.yaml` via Probot Settings.

## Missing Ecosystem Integration

This is the first `fro-bot/*` org repo surveyed. Compared to `marcusrbrown/*` repos, the following standard integrations are absent:

| Integration            | Status        | Notes                                                              |
| ---------------------- | ------------- | ------------------------------------------------------------------ |
| Fro Bot agent workflow | **Missing**   | No `.github/workflows/fro-bot.yaml` — follow-up PR recommended    |
| Fro Bot Autoheal       | **Missing**   | No autoheal workflow                                               |
| Probot Settings        | **Missing**   | No `.github/settings.yml` — branch protection not managed          |
| Renovate               | **Missing**   | No Renovate config (reasonable given zero dependencies)            |
| README                 | **Missing**   | No repository documentation                                        |
| License                | **Missing**   | No license file                                                    |
| HTTPS enforcement      | **Missing**   | Cert is valid and current; enforcement off ⇒ live TLS downgrade on the `github.io` → apex redirect (2026-09-09) |
| CodeQL / Scorecard     | **Missing**   | Issue #1 tracks this gap                                           |
| Copilot Setup Steps    | **Missing**   | No Copilot agent support                                           |
| `AAAA` DNS records     | **Missing**   | IPv4-only; IPv6-only clients cannot resolve `fro.bot` (2026-09-09) |
| Domain verification    | **Missing**   | `_github-pages-challenge-fro-bot` TXT record absent — the cause of the carried `unverified` state (2026-09-09) |
| `CAA` DNS records      | **Missing**   | No issuance constraint on the domain (2026-09-09)                  |

Given this repo has no application code and a single static file, most of these gaps are low-priority. The recommended follow-up actions are:

1. **Enable HTTPS enforcement** via GitHub Pages settings — **promoted to the top priority 2026-09-09.** This is no longer a hygiene checkbox: with it off, `https://fro-bot.github.io/` redirects to `http://fro.bot/` and no response on the domain carries HSTS. One toggle fixes the downgrade and turns on HSTS.
2. **Publish the `_github-pages-challenge-fro-bot` TXT record**, then verify `fro.bot` at the org level — closes the takeover exposure that has been recorded since 2026-06-15 but never root-caused until now. Requires access to `ns1/ns2.box.heatvision.co`.
3. **Add `AAAA` records** for `2606:50c0:8000::153` … `8003::153` — the Pages edge is dual-stack; only the custom domain is IPv4-only, so the domain is unreachable from IPv6-only networks for no reason.
4. **Add a `CAA` record** constraining issuance to the CA that actually serves the domain.
5. **Add Probot Settings** extending `fro-bot/.github:common-settings.yaml` for branch protection consistency
6. **Add a Fro Bot workflow** — even a minimal one for issue triage and settings oversight. **Still absent as of 2026-09-09** (`.github/workflows/fro-bot.yaml` → 404, eighth consecutive survey). This repo remains the ecosystem's only surveyed public repo with no agent workflow at all and no plausible reason to lack one beyond low perceived stakes — a follow-up draft PR is warranted, and this survey's findings (a live downgrade, a missing verification record, an IPv6 gap) are the argument for it: the repo has no code to review, but it has infrastructure state worth watching on a schedule.
7. **Add a README** with the repo's purpose and its relationship to the `fro.bot` domain

## Cross-References

- [[marcusrbrown--systematic]] — documentation site deployed to `fro.bot/systematic`
- [[marcusrbrown--infra]] — manages `cliproxy.fro.bot` (separate infrastructure, not served by this repo)
- [[marcusrbrown--mrbro-dev]] — sibling custom-domain GitHub Pages site pattern (React+Vite at mrbro.dev)
- [[marcusrbrown--marcusrbrown-github-io]] — sibling custom-domain GitHub Pages site pattern (React+Vite at marcusrbrown.com)
- [[fro-bot--systematic]] — the deploy target behind `fro.bot/systematic/`, the only live project path on this domain
- [[github-pages]] — topic page covering GitHub Pages deployment patterns across the ecosystem; carries the 2026-09-09 downgrade and measurement-channel findings from this survey

## Survey History

| Date       | SHA       | Delta                          |
| ---------- | --------- | ------------------------------ |
| 2026-05-07 | `3e44653` | Initial survey. Single-file repo, CNAME-only domain holder for `fro.bot`. |
| 2026-05-24 | `3e44653` | No-op re-survey. HEAD unchanged in 105 days (still the original 2026-02-09 `Create CNAME` commit). Pages config, TLS cert (expires 2026-07-09), missing-integrations table, and issue #1 (CodeQL/Scorecard parity) all unchanged. HTTPS still not enforced. No Fro Bot workflow — all four follow-up recommendations carried forward. |
| 2026-06-05 | `3e44653` | No-op re-survey. HEAD still unchanged (116 days since last push on 2026-02-09). Repo structure, Pages config, TLS cert (expires 2026-07-09, **now 34 days out — approaching renewal**), missing-integrations table, and issue #1 all unchanged. HTTPS still not enforced. No Fro Bot workflow. All follow-up recommendations persist. TLS cert expiry is the only new time-sensitive observation. |
| 2026-06-15 | `3e44653` | Re-survey. HEAD unchanged (126 days since last push on 2026-02-09); still the single `Create CNAME` commit. **TLS cert renewed:** expiry moved 2026-07-09 → **2026-09-07** (GitHub auto-renewed before the flagged window — no action needed). Pages config (`legacy` build, source `main:/`, `custom_404: false`, `https_enforced: false`), `protected_domain_state: unverified`, missing-integrations table, and issue #1 (CodeQL/Scorecard parity) all unchanged. HTTPS still not enforced. No Fro Bot workflow — all four follow-up recommendations carried forward. |
| 2026-06-26 | `3e44653` | No-delta re-survey. HEAD still frozen (140 days since last push on 2026-02-09); single `Create CNAME` commit, lone `CNAME` blob (`fro.bot`) is the entire tree. Pages config byte-for-byte identical to 2026-06-15 (`legacy`, source `main:/`, `custom_404: false`, `https_enforced: false`, `protected_domain_state: unverified`, cert `approved` for `fro.bot`/`www.fro.bot` expiring **2026-09-07**). Issue #1 (CodeQL/Scorecard parity) still the only open issue. No Fro Bot workflow, no Probot Settings, no README/license. Recorded repo `description` ("Custom domain pages for @fro-bot") for the first time. All four follow-up recommendations carried forward unchanged. |
| 2026-07-25 | `3e44653` | No-delta re-survey. HEAD still frozen (169 days since last push on 2026-02-09); `git ls-remote` confirms `main` = `3e44653`. Raw-content probes confirm the tree is unchanged: `CNAME` (`fro.bot`) present (HTTP 200); no README (404), no `.github/workflows/fro-bot.yaml` (404), no `.github/settings.yml` (404). Fro Bot workflow, Probot Settings, and README/license all still **absent** — all four follow-up recommendations carried forward. **Read-scope note:** this survey had no GitHub API token, so Pages config, TLS cert state, issue #1 status, and domain-verification fields could not be re-fetched; they are carried forward from 2026-06-26 unverified this cycle, not re-confirmed. TLS cert expiry **2026-09-07** now ~44 days out — approaching the next renewal window; watch on subsequent surveys. |
| 2026-08-10 | `3e44653` | No-delta re-survey. HEAD still frozen (185 days since last push on 2026-02-09); `git ls-remote` confirms `main` = `3e44653`. Raw-content probes confirm the tree is byte-identical: `CNAME` present and equal to `fro.bot` (HTTP 200); no README (404), no `.github/workflows/fro-bot.yaml` (404), no `.github/settings.yml` (404), no `index.html` (404). Fro Bot workflow, Probot Settings, and README/license all still **absent** — all four follow-up recommendations carried forward unchanged. **Read-scope note:** no GitHub API token this cycle (`GH_TOKEN`/`GITHUB_TOKEN` both unset), so Pages config, TLS cert state, issue #1 status, and domain-verification fields could not be re-fetched; carried forward from 2026-06-26 unverified, not re-confirmed. TLS cert expiry **2026-09-07** now ~28 days out — **inside the renewal window** (the ~90-day auto-renewal for a 2026-09-07 cert should surface a new far-future expiry around late-August/early-September); if a future token-bearing survey still shows 2026-09-07 past that point, escalate. |
| 2026-09-09 | `3e44653` | **Tree still frozen (212 days, eighth survey at the same SHA) — and the first survey to find real change, because it stopped asking GitHub and started asking the internet.** `git ls-remote` confirms `main` = `3e44653`; raw probes byte-identical (`CNAME` = `fro.bot` 200; README / `index.html` / `fro-bot.yaml` / `settings.yml` / `LICENSE.md` / `.nojekyll` all 404). No API token again — so this cycle measured the domain directly instead of carrying values forward. **Four findings.** (1) **Live TLS downgrade:** `https://fro-bot.github.io/` → `301 Location: http://fro.bot/` → cleartext 404, no HSTS anywhere, while `https://www.fro.bot/` → `https://fro.bot/` keeps the scheme — the `https_enforced: false` flag has a reproducible consequence, not just a checklist entry. (2) **The 2026-09-07 cert expiry is retired:** live handshake reads Let's Encrypt `CN=YR1`, `notBefore 2026-08-08`, `notAfter 2026-11-06`, SAN `fro.bot`/`www.fro.bot` — renewal happened **two days before** the 2026-08-10 survey warned it was pending, and the escalation trigger it wrote was conditioned on a token that was never needed. Generalized to [[github-pages]] as _carrying a value forward is a decision to stop measuring it_ and _prefer the channel that observes the artifact over the one that reports on it_. (3) **`unverified` root-caused:** `_github-pages-challenge-fro-bot.fro.bot` TXT does not exist — the domain was never verified because the challenge record was never published; DNS is self-hosted at `ns1/ns2.box.heatvision.co`, so the fix needs zone access, not a settings click. (4) **DNS gaps:** no `AAAA` (IPv4-only; unreachable from IPv6-only clients), no `CAA` (unconstrained issuance) on a domain that also runs mail (`MX box.heatvision.co`, SPF `v=spf1 mx -all`, DMARC `p=quarantine` with no `rua`) and signs published package authorship. Project-path probe: `fro.bot/systematic/` is the only live path (200, last-modified 2026-09-08); `/dashboard/`, `/agent/`, `/space-bus/`, `/schemas/` all 404. Incidental for [[fro-bot--systematic]]: OCX registry at `version 3.16.5`, **components flat at 73** (fifth consecutive). Follow-up list reordered — HTTPS enforcement promoted to #1, three DNS actions added; Fro Bot workflow still absent (eighth survey). |
