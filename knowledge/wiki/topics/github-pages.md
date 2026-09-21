---
type: topic
title: GitHub Pages
created: 2026-04-18
updated: 2026-09-21
sources:
  - url: https://github.com/marcusrbrown/systematic
    sha: f903dc6d1a81814418b7d72bae21ce460d2c9089
    accessed: 2026-09-21
  - url: https://github.com/fro-bot/systematic
    sha: 8e26a01
    accessed: 2026-09-04
  - url: https://github.com/fro-bot/systematic
    sha: c5cbd2e
    accessed: 2026-09-19
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-09-09
tags:
  [
    github-pages,
    deployment,
    ci-cd,
    static-sites,
    release-gated-deploy,
    cross-repo-deploy,
    esp-web-tools,
    jekyll,
    astro,
    starlight,
    git-lfs,
    csp,
    analytics,
    slidev,
    custom-domains,
    monorepo,
    tls,
    dns,
    https-enforcement,
  ]
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--esphome-life
  - marcusrbrown--presentations
  - fro-bot--systematic
  - fro-bot--fro-bot-github-io
---

# GitHub Pages

Static site hosting via GitHub. Deployment patterns observed across the Fro Bot ecosystem.

## Repos Using GitHub Pages

- [[marcusrbrown--mrbro-dev]] — React 19 + Vite 7 portfolio, custom domain at mrbro.dev
- [[marcusrbrown--marcusrbrown-github-io]] — React 19 + Vite 7 brand site, custom domain at marcusrbrown.com
- [[marcusrbrown--esphome-life]] — Jekyll (slate theme) + ESP Web Tools firmware installer, deployed to `gh-pages` branch
- [[fro-bot--systematic]] — Starlight/Astro docs site for `@fro.bot/systematic`, deployed to `gh-pages` branch at fro.bot/systematic/
- [[marcusrbrown--presentations]] — multi-deck slide archive (CRA/Spectacle + Slidev), assembled from two independent toolchains into one `_site/` and deployed via the Pages artifact API (2026-08-05, `#60`)
- [[fro-bot--fro-bot-github-io]] — org-level custom-domain holder for `fro.bot`; a single `CNAME` blob, legacy build from `main:/`, no content of its own

## Deployment Patterns Observed

### Vite + GitHub Actions

The pattern used in [[marcusrbrown--mrbro-dev]]:

1. Build with Vite (`pnpm run build`) using `GITHUB_PAGES=true` env variable
2. Upload via `actions/upload-pages-artifact` (targets `./dist`)
3. Deploy via `actions/deploy-pages`
4. Requires `pages: write` and `id-token: write` permissions
5. Concurrency group `pages` with `cancel-in-progress: false` to prevent partial deploys

The deploy workflow runs lint and test gates before building, ensuring only validated code reaches production.

### Custom Domains

Two Marcus repos use custom domains with GitHub Pages:

- **mrbro.dev** — [[marcusrbrown--mrbro-dev]], full portfolio with React Router
- **marcusrbrown.com** — [[marcusrbrown--marcusrbrown-github-io]], single-page brand site (CNAME in `public/`)

Both use Vite with `base: '/'` for custom domain compatibility (no path prefix needed).

### Jekyll + ESP Web Tools (Firmware Distribution)

The pattern used in [[marcusrbrown--esphome-life]]:

1. CI builds ESPHome firmware via `esphome/build-action@v7.1.0` with a matrix of device YAML files
2. Build artifacts are uploaded and combined into a single `manifest.json` (jq merge of per-device manifests)
3. Static site files from `static/` are copied alongside the manifest
4. Deployed to `gh-pages` branch via `JamesIves/github-pages-deploy-action@v4.8.0`
5. Commit author is `mrbro-bot[bot]` using a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` secrets)
6. The site uses `esp-web-tools@8.0.3` to provide browser-based USB firmware flashing

This pattern is distinct from the SPA deploy pattern — it serves firmware binaries alongside a minimal Jekyll site rather than a JS application bundle.

### Starlight/Astro Cross-Repo Deploy

The pattern used in [[marcusrbrown--systematic]] → [[fro-bot--systematic]]:

1. Astro/Starlight docs site lives in the source repo (`marcusrbrown/systematic/docs/`)
2. A `docs.yaml` workflow in the source repo builds the site and pushes output to a separate repo (`fro-bot/systematic:gh-pages`)
3. GitHub Pages serves the `gh-pages` branch at `fro.bot/systematic/`
4. All commits on the target repo are authored by `fro-bot[bot]` with provenance messages linking back to the source SHA
5. `.nojekyll` disables Jekyll processing; Pagefind provides client-side search
6. `.well-known/ocx.json` serves the OCX component registry, enabling `ocx` CLI to install skills/agents from the docs URL

This cross-repo pattern separates the docs deployment surface from the source repo, keeping the source repo's Pages available for other uses and giving the docs site its own URL under the `fro-bot` org.

**Footgun — config files on a build-output branch.** On 2026-06-24, [[fro-bot--systematic]] merged a `.github/renovate.json5` directly onto `gh-pages` (its default, build-output branch). Because every other commit on that branch is a `fro-bot[bot]` "Deploy docs from ..." overwrite, hand-authored config living there is fragile: the next docs build can clobber or orphan it unless the source-repo build pipeline explicitly preserves the path. Onboarding a build-output-only repo into Renovate also adds operational surface (and, in this case, a config-error issue that halted Renovate) without a dependency target to update — there is no `package.json` on a pure static-output branch. When a deploy-target repo is one branch of build artifacts, repo automation that assumes a normal source branch tends to mis-fire.

**A frozen deploy target is not evidence of a broken pipeline (2026-09-04, [[fro-bot--systematic]]).** The wiki carries several cases where a motionless tree concealed a dead daemon — [[bfra-me--ha-addon-repository]] (17 consecutive failed scheduled runs), [[marcusrbrown--cortexkit-anthropic-auth]] (`disabled_inactivity`). This is the inverse case, and it matters because the two look identical from the outside.

`fro-bot/systematic:gh-pages` sat at one SHA for 10 days. Nothing was wrong. The deploy fires on **npm publish**, and the upstream interval contained 16 commits of which one was `docs:` and fifteen were `chore(deps)`/`chore(dev)` Renovate automerges — no `feat:`/`fix:`, therefore no semantic-release publish, therefore no deploy. A stale deploy target under a conventional-commits release gate is a **truthful signal that nothing user-visible shipped**.

Two rules for auditing any cross-repo deploy target:

- **Measure the gate, not the tree.** The deploy target's `pushed_at` tells you when the gate last opened, not whether the gate still works. Compare it against the producer's _release_ feed.
- **`pushed_at` on the source repo is the wrong probe.** It counts pushes to every branch, including open PR branches. Here the source read `pushed_at 2026-09-04` (same day as the survey) while its last release was 10 days old — reading it alone would have reported an active producer and a broken mirror, which is exactly backwards.

**Cadence is bursty because releases are bursty.** Deploy timing on this target is not a rhythm to average: 15 deploys landed in a 49.5-hour window, bracketed by a 3.2-day gap before and a 10-day drought after, with an earlier 9.2-day drought in the prior interval. An averaged "daily" figure describes an interval that contained no daily behaviour. Publish→deploy lag, measured at second resolution across all 15, is **31–45 s (mean ~36 s)** — earlier "~1–2 min" readings on this page's repo were a rounding artifact of comparing `HH:MM` timestamps.

**Amendment 2026-09-19 — cadence has no characteristic period, and the lag changed sign.** Two corrections from the next [[fro-bot--systematic]] interval (19 deploys, `3.15.1` → `3.18.10`).

*(a) Withdraw the periodicity claim.* The 2026-09-04 entry concluded the durable shape was "burst-and-drought at ~10-day period." The following interval was neither: 19 deploys in 14.4 days, median gap ~21 h, maximum gap 67.4 h, no burst and no drought. Three consecutive intervals from an unchanged pipeline produced three regimes — burst, drought, sustained-daily. What survives is the *mechanism*, not the shape: a release-gated deploy target's cadence is a pure function of whether releasable commit types are landing upstream, and that is set by human work patterns, not by anything in the pipeline. **Report the gap distribution; never report a mean, and never forecast the next interval from the last one.** The 09-04 warning that a survey landing inside a drought should not read it as a fault has a twin: a survey landing inside a steady run should not read it as a new rhythm.

*(b) The publish→deploy lag is now negative, and the sign is the finding.* Twelve consecutive releases measured **+31…+88 s** (deploy commit after the npm publish), then seven consecutive measured **−31…−118 s** (deploy commit *before* it), with no straddling value and a visibly wider spread after the flip. Sequential jobs became concurrent ones. Consequences that generalize to any pipeline publishing one release to two channels:

- **A parallelized fan-out has a window in which the channels disagree, and the disagreement is not a fault.** For 31–118 s the docs site and its OCX registry advertised a version npm did not yet serve. Any consumer that reads one channel and resolves from the other can 404 inside that window.
- **Cross-channel equality checks become races, not identities.** This wiki had verified "registry version = npm `dist-tags.latest`" across eleven surveys and read it as an invariant. It is now only *eventually* true. **A mismatch between two artifacts of a parallel pipeline is only meaningful if it outlives the fan-out window** — re-poll before reporting drift.
- **Measure lag with signed, sub-minute resolution or not at all.** The long-carried "~1–2 min" figure came from differencing rendered `HH:MM` strings, which cannot see a 31-second effect and certainly cannot see it change sign. npm packument `time` values are millisecond-precision; git author dates are second-precision; both are free.
- **The gate did not move.** Every deploy still maps 1:1 onto a publish, so *measure the gate, not the tree* is untouched. Only the internal ordering of the release job changed — which is exactly the kind of change that is invisible to anyone auditing the deploy target's tree and visible to anyone timing its commits.

**Amendment 2026-09-21 — amendment (b) above is withdrawn. The pipeline did not change; the instrument did.** The first source-side look at [[marcusrbrown--systematic]] since the flip (HEAD `f903dc6d`) reproduces the measurement exactly — 18 releases, 18 deploy commits, 1:1, `+37 s` at `3.18.3` and `−59 s` at `3.18.4`, clean flip, no straddle — and refutes the diagnosis three ways:

- **`.releaserc.yaml` has been byte-stable since 2026-05-23** (seven touches ever, the last one #432). `@semantic-release/npm` still precedes `@semantic-release/github`, so the publish call still happens before the GitHub-release creation that fires the deploy.
- **`docs.yaml` is a separate workflow triggered by `release: [published]`**, not a job inside the release workflow. There was never a job graph to parallelize, and there is no "sequential jobs became concurrent" event to point at.
- **Every Docs run in both regimes is a `release`-event run of ~35–45 s.** Differencing each run's own `created_at` against the npm `time` entry shows the GitHub release firing **1.7 s after** npm for `v3.18.3` and **93 s before** it for `v3.18.4`. The offset that moved is between the publish call and the **registry's own `time` row** — upstream of the repository entirely.

The rule that should have caught it, and that now supersedes bullet (b): **a cross-channel lag measures the pipeline only when it exceeds the work the pipeline must do between the channels.** The original `+34 s` regime was already impossible as a causal chain — 34 s does not cover `bun install`, a Playwright Chromium install, `docs:generate`, an Astro build, a clone of another repository, and a force-push. When a measured lag is smaller than the known floor for the work, you are differencing two clocks rather than timing one process. Read the **run's `created_at`**, which is the only timestamp the pipeline itself emits.

Three consequences for this page:

- **Withdrawn: "for 31–118 s the docs site advertised a version npm did not serve."** A registry `time` field records when a row was written, not when a tarball became resolvable; it cannot support an availability claim in either direction. The real exposure, if any, needs a resolution probe.
- **Withdrawn: "cross-channel equality checks become races, not identities."** The eleven-survey registry ↔ `dist-tags.latest` mirror is still an identity with a ~40 s propagation delay, which is what it always was. The advice to *re-poll before reporting drift* survives on its own merits; the reasoning behind it does not.
- **Kept and strengthened: measure with signed, sub-minute resolution.** Doing so is what made the anomaly visible. What was missing was the second step — checking whether the measured magnitude was even physically possible for the process being inferred.

**New, and structural: the 1:1 deploy↔release mapping is contingent, not guaranteed.** The deploy step ends with `git add -A; if ! git diff-index --quiet HEAD --; then commit && push --force; else echo "No changes to commit"; fi`. A release whose rendered docs tree is byte-identical produces **no deploy commit at all**. It held 18/18 this interval, but an index-paired timing series would shift permanently on the first skip — which is the *other* mechanism that produces a clean sign flip with no straddling value, and the first thing to check whenever such a pairing looks off by one. Related deploy-step facts worth recording for any cross-repo Pages target: the push is a `git push --force` into another org's repo under a scoped App token, preceded by `find . -mindepth 1 -not -path './.git' -not -path './.git/*' -delete` (full wipe-and-replace, so anything hand-added to the branch dies on the next deploy — the 2026-06-24 footgun above, now confirmed mechanically); it is guarded by `if: github.repository == '<source>'` so a fork cannot reach the token; prereleases are excluded via `!github.event.release.prerelease`; and `concurrency: {group: docs-deploy, cancel-in-progress: true}` means two releases inside one ~40 s deploy would cost the earlier one its deploy entirely.

### Custom Domains: What the Repo Controls vs. What DNS Controls

**HTTPS enforcement is not a hygiene checkbox — it decides the scheme of GitHub's canonical redirect (2026-09-09, [[fro-bot--fro-bot-github-io]]).** Six surveys recorded `https_enforced: false` on the `fro.bot` holder as a to-do item. Probing the live domain produced the consequence:

```text
https://fro-bot.github.io/  →  301  Location: http://fro.bot/      ← TLS dropped
http://fro.bot/             →  404  (cleartext, no upgrade, no HSTS)

https://www.fro.bot/        →  301  Location: https://fro.bot/     ← TLS preserved
```

When a repo sets a custom domain, Pages redirects `<owner>.github.io` to that domain — and emits the redirect at `http://` while enforcement is off. A visitor who arrives over TLS is redirected out of it. The `www` → apex redirect is unaffected, so the same domain produces two different scheme outcomes depending on entry point, and neither response carries `Strict-Transport-Security` (Pages only sends HSTS when enforcement is on). Any audit that reads `https_enforced: false` and files it as low-severity because "the site is served over HTTPS anyway" has measured the wrong hop. Check the redirect chain from the `github.io` name, not just the apex.

**A custom domain splits ownership across two systems, and only one of them is in the repo.** The `CNAME` blob is the whole repo-side contribution; everything else that makes the domain safe lives in DNS, where no repo automation looks:

| Concern | Lives in | Failure mode when absent |
| ------- | -------- | ------------------------ |
| Domain → Pages routing | `A` / `CNAME` records | Site unreachable — loud, gets fixed |
| IPv6 reachability | `AAAA` records | **Silent.** The Pages edge is dual-stack (`<owner>.github.io` → `2606:50c0:800{0,1,2,3}::153`), but a custom domain inherits none of it — `fro.bot` publishes only `A`, so IPv6-only clients cannot reach it, and nothing in GitHub's UI mentions the gap |
| Org domain verification | `_github-pages-challenge-<org>` TXT | **Silent.** Domain stays takeover-eligible if the CNAME is ever removed |
| Certificate issuance constraint | `CAA` records | **Silent.** Any CA may issue |
| Scheme of the canonical redirect | Pages repo setting | Silent downgrade (above) |

Three of the five are invisible to every repo-level lint the ecosystem runs, because the artifact under test is a DNS zone. `protected_domain_state: unverified` had been recorded on that page since 2026-06-15 as a state; a single `dig` showed the cause is a missing challenge TXT record at self-hosted nameservers — i.e. the remediation was never a settings click. **For any custom-domain Pages repo, the survey unit is domain + repo, not repo.**

### Measurement Channels: Observing the Artifact vs. Reading the Report

**Carrying a value forward is a decision to stop measuring it (2026-09-09, [[fro-bot--fro-bot-github-io]]).** That page tracked a TLS expiry of 2026-09-07 across three token-less surveys, each labeling it "carried forward, not re-confirmed," and the last one wrote an escalation trigger conditioned on a future token-bearing survey. A single `openssl s_client` — available every one of those cycles — showed the certificate had actually been reissued on 2026-08-08, two days before the survey that warned the renewal was still pending.

The failure was not the absence of a token. It was treating one channel's unavailability as the fact's unavailability. Two rules:

- **Prefer the channel that observes the artifact over the one that reports on it.** The GitHub API describes intended Pages configuration; a TLS handshake, a redirect chain, and `dig` observe what clients actually receive. For custom domains the observing channels are unauthenticated, cheaper, and closer to ground truth — GitHub's own view can also lag its edge.
- **Every carry-forward should name the cheapest independent channel, not just the unavailable one.** "Not re-confirmed this cycle" is honest about provenance and silent about feasibility; those are different claims, and conflating them is how a stale value survives long enough to generate a false alarm.

This is the inverse of the [[fro-bot--systematic]] lesson recorded above (_measure the gate, not the tree_): there, the wrong probe was too eager; here, the right probe was never attempted. Both reduce to picking the channel whose semantics match the question.

## Performance Monitoring

[[marcusrbrown--mrbro-dev]] runs Lighthouse CI against the deployed site with device-specific budgets:

- Desktop: Performance >= 95%, LCP <= 2s, CLS <= 0.05
- Mobile: Performance >= 90%, LCP <= 2.5s, CLS <= 0.1
- Resource budgets: JS <= 512KB, CSS <= 100KB, total <= 2MB

Weekly scheduled performance runs (Monday 06:00 UTC) establish baselines for regression detection.

## Footgun — Git LFS and web-served assets

GitHub Pages does **not** resolve Git LFS pointers. If a binary asset (image, font, etc.) is tracked by LFS and committed as a pointer file, Pages serves the ~130-byte pointer text verbatim instead of the blob — the asset renders broken in production even though it displays correctly in the GitHub UI and local checkouts (which transparently smudge LFS pointers).

[[marcusrbrown--mrbro-dev]] hit this on 2026-07-26 (#228): self-hosted project-preview PNGs added a week earlier (#202) were tracked by a repo-wide `*.png filter=lfs` rule, so the images broke on the live site. The fix is a **`.gitattributes` exemption** that overrides LFS for the web-served path while keeping it for other PNGs:

```gitattributes
*.png filter=lfs diff=lfs merge=lfs -text

# Web-served preview images must be real blobs — GitHub Pages does not resolve LFS pointers
public/project-previews/*.png filter= diff= merge= -text
```

The empty `filter=`/`diff=`/`merge=` values unset the inherited LFS attributes for the narrower glob, forcing those files to commit as real blobs. General rule: any binary that ships in a Pages build output (`dist/`, `public/`) must be a real Git blob, not an LFS pointer.

## Build-time-gated, self-hosted analytics on a Pages SPA

[[marcusrbrown--mrbro-dev]] added a privacy-preserving web-analytics subsystem on 2026-08-01 (#256/#257) that is a reusable template for adding telemetry to a static Pages site without violating a no-unconsented-telemetry baseline:

- **Self-hosted processor, not a SaaS vendor.** The tracker points at a self-hosted Umami instance (`metrics.fro.bot`, an [[marcusrbrown--infra]] app), so no third-party analytics script loads and no data leaves the operator's own infrastructure.
- **Build-time injection gated on a repo variable.** Because a Pages SPA has no server, activation is a *build-time* decision: a GitHub repo variable (`UMAMI_WEBSITE_ID`) is mapped to a Vite env var (`VITE_UMAMI_WEBSITE_ID`) **only on the build step** of `deploy.yaml` (step-scoped, so it can't leak into unrelated steps). Vite injects exactly one tracker tag only when the variable is set; unconfigured builds and dev builds ship no tag. Leaving the variable unset is the **fail-closed default** — the deployed artifact contains no tracker until a human sets it.
- **Human activation gate + operator runbook.** `docs/analytics.md` carries a Go/No-Go matrix that blocks activation until version-controlled infrastructure evidence proves the retention boundary. The gate lives in docs + process, not in code, because the code already fails closed.
- **CSP-safe static bootstraps.** To keep a strict Content-Security-Policy (no inline `<script>`), executable SPA bootstraps (theme preload, SPA redirect/restore for the 404-rewrite trick) were moved from inline `index.html` into tested `public/scripts/*.js` files served as real static assets. This is a general Pages-SPA pattern: inline bootstrap logic that a redirect/theme flash needs must become external scripts to satisfy CSP, and they can be unit-tested in isolation.

General rule for Pages SPAs: telemetry activation is a build-time env decision (fail closed when unset), the processor should be self-hosted to honor a no-unconsented-telemetry baseline, and any bootstrap that would otherwise be an inline `<script>` should be an external, testable `public/scripts/*.js` asset for CSP compatibility.

## Multi-toolchain `_site` assembly on the artifact API (2026-09-01)

[[marcusrbrown--presentations]] publishes two decks built by two unrelated toolchains — Create React App under Yarn/Node 20, and Slidev under Bun — from a single `Build` job, without a monorepo, a workspace, or a shared package manager. The shape is worth reusing for any repo that hosts several independently-versioned static artifacts:

1. Build each artifact in its own `working-directory` with its own toolchain (`yarn build`; then `oven-sh/setup-bun` + `bun run build`).
2. **Assemble in an explicit staging step**, not by pointing the uploader at a source directory:

   ```yaml
   - name: Assemble Pages site
     working-directory: .
     run: |
       mkdir -p _site/Deck-A _site/Deck-B
       cp index.html _site/index.html
       cp -R Deck-A/build/. _site/Deck-A/
       cp -R Deck-B/dist/. _site/Deck-B/
   ```

3. `actions/configure-pages` → `actions/upload-pages-artifact` (path `_site`) → a separate `Deploy` job running `actions/deploy-pages`.

Three properties that make this good rather than merely working:

- **Least privilege by job.** `pages: write` + `id-token: write` live only on the `Deploy` job; `Build` and `Test` keep workflow-level `contents: read`. The elevated grant covers one step.
- **The assembly step is unguarded; the Pages steps are not.** `configure-pages`, `upload-pages-artifact`, and the whole `Deploy` job carry `if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'`, but the `mkdir`/`cp` runs on every PR. A PR that breaks the site layout fails in review, not at deploy.
- **Each sub-artifact must know its own base path at build time.** The Slidev deck hard-codes `--base /Presentations/Deck-B/` in its build script. Static-site generators emit absolute asset URLs; the staging layout and the per-artifact base path are one coupled decision, and getting them out of sync produces a site that builds green and 404s every asset.

**Migration note:** adopting the artifact API orphans the older `gh-pages`-branch path. In this case the CRA deck retained `gh-pages` as a dependency plus `predeploy`/`deploy` scripts that nothing invokes — and Renovate independently flagged `gh-pages` as abandoned upstream. Deleting the old deploy path is part of the migration, not a follow-up.

## Project Pages inherit the user site's custom domain

When a user Pages site (`<user>.github.io`) has a custom domain, every **project** Pages site under that account is served from the custom apex, not from `github.io`. [[marcusrbrown--presentations]]'s canonical URL moved from `marcusrbrown.github.io/Presentations/` to `mrbro.dev/Presentations/` with no change to its own Pages configuration — the move happened because `marcusrbrown.github.io` is the [[marcusrbrown--mrbro-dev]] portfolio, whose `CNAME` is `mrbro.dev`.

Practical consequences:

- **A repo's canonical Pages URL can change without that repo changing.** Anything asserting the old host — READMEs, QR codes, `homepage` fields, wiki pages, external links — silently becomes a redirect at best. Here the `settings.yml` `homepage` was updated but the CRA deck's `package.json` `homepage` still hard-codes `https://marcusrbrown.github.io/Presentations/…`.
- **Prefer relative or `--base`-relative asset paths** over absolute URLs containing the host, so the artifact is host-agnostic.
- Compare [[fro-bot--fro-bot-github-io]], which exists solely to hold the org-level `CNAME` — the same coupling from the other side: one repo owns the domain, every sibling inherits its consequences.
