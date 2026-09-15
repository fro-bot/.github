---
type: repo
title: bfra-me/ha-addon-repository
created: 2026-05-20
updated: 2026-09-15
sources:
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-05-30
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-06-10
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-06-20
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-07-02
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-07-16
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-08-07
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-08-31
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: b7bcd528f511809e0f5906af42ca6ff131c1ff1e
    accessed: 2026-09-15
tags:
  - home-assistant
  - addon
  - hassio
  - template
  - docker
  - multi-arch
  - bfra-me
  - renovate
  - supply-chain
  - security-scanning
  - agent-instructions
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - marcusrbrown--containers
  - marcusrbrown--github
  - marcusrbrown--tokentoilet
  - marcusrbrown--sparkle
  - home-assistant
  - docker-containers
  - github-actions-ci
  - probot-settings
node_id: R_kgDOIKWaJA
---

# bfra-me/ha-addon-repository

Template repository for a Home Assistant add-on repository. GitHub template (`is_template: true`) under the `bfra-me` org, used as the blueprint when starting a new HA add-on collection. The repo ships one example add-on (`example/`) that gets built and published to GHCR.

This is the bfra-me ecosystem's add-on counterpart to Marcus's runtime [[marcusrbrown--ha-config]] — where ha-config consumes add-ons and integrations, this repo defines the scaffolding for building and publishing new ones.

## 2026-09-15 — The parked car started, and it was not a maintenance interval

Eight consecutive surveys (2026-05-20 → 2026-08-31) recorded the same frozen tree at `0a163c3f`, the same five blocked Renovate PRs, and a widening gap between pinned versions and Renovate's targets. That narrative ended at **2026-09-01T02:13:44Z**, when `marcusrbrown` submitted a single `APPROVED` review on PR #557 — a one-line, one-file dependency bump that had waited **107 days**.

Everything downstream followed within 34 commits over 14 days: HEAD `0a163c3f` → **`b7bcd528`**, tree **31 → 45 blobs**, workflows **4 → 7**, authorship `bfra-me[bot]` 16 / **`marcusrbrown` 15** / `fro-bot` 3. Every structural item this page carried as an open finding since May was addressed, and three new ones opened.

Read the interval as three distinct phases:

| Phase | Window | Character |
|---|---|---|
| **Unblock** | 09-01 02:13 → 06:23 | 4h10m. Human approves the backlog; the revived agent lands 3 PRs; architecture set is cut; the build system is replaced. |
| **Harden** | 09-02 → 09-03 | 12 human PRs. Security scanning, release-integrity gates, agent/contributor docs, community health files, three least-privilege fixes. |
| **Drift** | 09-04 → 09-15 | The `tar` outage, then a quiet 10 days in which the agent runs green nightly and delivers nothing. |

### The review deadlock was attention, not risk

The asymmetry is the finding. PR **#557** (`fro-bot/agent` v0.43.1 → v0.107.0, `+1/-1`, one file) waited 107 days. PR **#564** (`fro-bot`-authored, *dropping two published architectures*, `+11/-18` across 7 files) was opened at 02:35, approved at 03:00, merged at 03:00:14 — **25 minutes**.

Same reviewer, same branch protection, same `enforce_admins: true`, same one-approval requirement. The 4,000× latency spread does not track diff size, blast radius, or reversibility. It tracks whether the reviewer was in a session. Every prior survey's framing — "the review pipeline is the bottleneck," "CI is green, the bottleneck is purely human/governance" — was correct as diagnosis and mis-specified as a *process* problem. There is no queue-management fix for this. The gate is one person's calendar.

The corollary matters for auditing the rest of the fleet: a long-lived green-but-unmerged PR queue measures reviewer presence, not review difficulty, and the two are indistinguishable from outside until the reviewer shows up.

### Correction: the autoheal daemon recovered before anything changed

The 2026-08-31 survey recorded 17 consecutive `failure` conclusions on `Fro Bot` scheduled runs since 2026-08-14 and reasoned that "an ~4-month-stale pinned harness that worked for months and then failed abruptly on a fixed date across every subsequent run points at an external contract the v0.43.1 harness can no longer satisfy."

**That inference is superseded.** Run 8472 at **2026-08-31T20:54:25Z** concluded `success` — on unchanged HEAD `0a163c3f`, still pinned to `fro-bot/agent@v0.43.1`, roughly six hours *before* the first commit of the unblock phase and 5h21m before the agent bump merged. Nothing in the repository changed between the 17th failure and the recovery.

So the outage was **transient and externally self-healing**, not a durable version-incompatibility. The observed data (a fixed start date, a uniform early failure in the `Run Fro Bot` step, a stale pin) supported both hypotheses equally; the page picked the one with a satisfying mechanism. The rule this yields: *a failure streak that ends without a change was never a compatibility problem, and a stale pin adjacent to an outage is a co-occurrence until something is bumped and the failure stops.* The survey was right about the outage and wrong about its cause, and the correction was only available one cycle later.

What survives unchanged is the *detection* finding, which was never about root cause: 17 days of red never touched mergeability, because `Fro Bot` as a required check is evaluated on `pull_request` events where the bot guard makes it skip, and skipped counts as passing. That is now the seed of the repo's best new pattern (see below).

### The agent can no longer deliver, and it says so nightly

The revived daemon is running, competent, and structurally severed from the repository.

`fro-bot`'s last delivered artifact is PR **#565**, merged 2026-09-01T03:29:47Z. Since then: **zero** PRs, zero commits, zero branches — across 13 consecutive `success` scheduled runs (one `failure` on 09-12).

The reason is in the daemon's own report. The top of issue #554 states:

> This run's delivery mode is `working-dir` (schedule contract): the two-file doc fix (`AGENTS.md`, `CONTRIBUTING.md`) was written directly to the checked-out working tree for the caller workflow to diff, commit, and open …

`fro-bot.yaml`'s job has exactly two steps: `Checkout repository` and `Run Fro Bot`. **There is no third step.** The harness moved commit/push/PR delivery to the caller, and this workflow never grew that half — the identical break documented at [[marcusrbrown--tokentoilet]], repaired at [[fro-bot--dashboard]], and repaired best at [[marcusrbrown--sparkle]].

What makes this instance the most legible in the fleet is that **the daemon publishes a counter of its own failed deliveries**. From the 2026-09-15 report:

> **Recurring doc-version drift, now the 12th consecutive occurrence** (2026-09-04 through 2026-09-14, every run) … `git log --all -- AGENTS.md CONTRIBUTING.md` confirms no PR has ever landed this fix since #576/#581. Re-applied the `3.13.15`/`3.9.6` correction to the working tree this run (2 files, 4 lines).

Twelve nights, the same four lines, into a working tree the runner deletes. The agent even ran `git log --all` and correctly concluded the fix has never landed — it has diagnosed its own severance and has no instruction that would let it escape. Categories 1–3 report ✅ every night because *reading* is intact; only the write path is cut, and a report that scores categories independently cannot express "everything I concluded was correct and none of it shipped."

Two hardening changes are adjacent in time and may be implicated, but causality is **not established from outside**: #586 (`persist-credentials: false` on the checkout, 09-03T02:25) removed the credential a push would need, and #587 capped the Renovate job at `contents: read`. The missing delivery step is sufficient on its own — a working-dir handoff to a caller that has no handler fails whether or not a credential exists. The fleet-strongest repair is [[marcusrbrown--sparkle]]'s single `Resolve delivery mode` step feeding both the agent's `output-mode` input and the conditional credential restore; this repo has neither half.

### `.github/settings.yml` is a manifest nobody can reliably apply

Issue **#569** (`marcusrbrown`, 2026-09-01, still open) is the most valuable human-authored artifact in the repo's history — the first substantive non-bot issue ever filed here — and it documents a green sync that syncs nothing.

The exchange is worth preserving in shape, because it is a clean record of an agent triage being wrong and being corrected:

1. **The agent's triage** blamed PR #565 (`bfra-me/.github` v4.16.16 → v4.23.0), filed 52 minutes after that PR merged. It disclosed its own limitation in the same comment — *"I could not access authenticated job logs or run `gh` in this environment"* — and then attributed the failure to the nearest recent change anyway. Evidence-starved triage reaches for adjacency; the honest limitation statement and the unsupported conclusion sat in the same paragraph.
2. **The human corrected it** with better evidence: identical annotations back to 2026-08-24 on unchanged commit `0a163c3`, days before the bump; a control repo (`bfra-me/works`) passing 6/6 on the same action version in the same window; and a hand-replayed branch-protection `PUT` that succeeded, ruling out the payload.
3. **The agent accepted the correction on-thread** and restated the record. That loop — propose, refute with control evidence, retract — is the behavior the autoheal design is supposed to produce and rarely does.

The mechanism the human surfaced is the durable part:

> **Push-triggered runs are false green.** `dorny/paths-filter` skips the apply step unless `.github/settings.yml` itself changed. Run 33468117102 reports success but its `Update Repository Settings` step was *skipped*. Only `schedule` runs actually apply anything, so "re-run to check for transience" would have produced a meaningless pass.

This is a sharper variant of the fleet's most-cited rule (*a run's conclusion measures the harness, not the deliverable*, from [[marcusrbrown--cortexkit-anthropic-auth]] and [[marcusrbrown--github]]). Here the green is not accidental — it is **green by design on the majority of runs**. `Update Repo Settings` has 621 runs; most are push-triggered no-ops that conclude `success` while applying nothing. A monitor watching that workflow's conclusion would report continuous health through an outage of any length.

Root cause per the thread: an intermittent 5xx from the GitHub REST branch-protection call that `update-repository-settings` neither retries nor surfaces a response body for — hence the empty `Failed to apply branches settings:` annotation. Blocked upstream on `bfra-me/.github#2667`. The human's closing note:

> `.github/settings.yml` is currently not a reliable way to change this repository's configuration. Branch protection changes need applying by hand and verifying afterwards.

**Current status (2026-09-15):** the three most recent listed scheduled runs (09-08, 09-09, 09-10) concluded `success` and the 09-14T19:24 run succeeded, so the intermittent 5xx appears to have cleared. #569 remains open, correctly — the sync is unretried and unlogged, so the next silent window is undetectable by the same means. The applied branch-protection state could **not** be verified this cycle (`/branches/main/protection` requires auth; returned 401), so whether the three new required contexts declared in `settings.yml` are live on `main` is **unverified**. See [[probot-settings]].

### The `tar` outage, third repo, and the minimum-viable-fix residue

This repo is the third confirmed casualty of the `bfra-me/renovate-action` 10.34.0 incident (`tar` left a devDependency; Renovate exits before servicing any dependency while concluding `success`), after [[marcusrbrown--github]] and [[marcusrbrown--esphome-life]]. Full chain here:

| Time (UTC, 2026-09-04) | Event |
|---|---|
| 16:56:07 | **#588** (Renovate) bumps `bfra-me/.github` → **v4.25.0** in *both* `renovate.yaml` and `update-repo-settings.yaml` — the poisoned ref, installed by the updater into itself |
| ~18:27 | Upstream fixes; **v4.25.1** tagged 20:52 |
| 22:57:14 | **#589** (`marcusrbrown`, hand-authored) bumps **only `renovate.yaml`** → v4.25.1 |

Inert window ≈ **6h01m**. The three repos' hand-fixes landed at **22:56**, **22:57**, and **23:01** — three repositories inside a five-minute window, which pins the earlier "manual fleet sweep" reading at [[marcusrbrown--esphome-life]] to a single operator session with a concrete duration.

The new contribution is the residue. [[marcusrbrown--esphome-life]] documented the two-callers problem as an *incident amplifier* — merging the fix re-ran the poisoned runner. Here the operator triaged correctly in the opposite direction: `update-repo-settings.yaml` does not need Renovate to recover, so it was deliberately left alone. Consequence: that workflow ran a ref known to ship a broken Renovate bundle for **ten days**, until Renovate itself caught up via **#590** (09-14T06:01, both files → v4.25.1).

The rule: **when a fix must be hand-applied under time pressure, the minimum-viable fix and the complete fix are different file sets, and only the bot closes the gap.** Recovery time (6h01m) and remediation time (10 days) are different quantities; an audit reporting either alone describes a different incident. Generalized into [[github-actions-ci]].

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public, template (`is_template: true`)
- **License:** Apache-2.0
- **Default branch:** `main`
- **Primary language:** Dockerfile
- **Topics:** `addon`, `addons`, `hassio`, `home-assistant`, `homeassistant`, `template`
- **Created:** 2022-10-08 · **Repo id:** `547723812` · **`node_id`:** `R_kgDOIKWaJA`
- **HEAD:** `b7bcd528f511809e0f5906af42ca6ff131c1ff1e` (2026-09-14T16:36:34Z)
- **Stars / forks / watchers:** 2 / 1 / 2 (steady across all nine surveys)
- **`open_issues_count`:** 7 = 4 Renovate PRs + 3 issues (#4 Dependency Dashboard, #554 Daily Autohealing Report, #569 settings-sync failure)

## Layout

```
.
├── .cortexkit/.gitignore
├── .devcontainer.json
├── .gitattributes
├── .gitignore
├── .markdownlint-cli2.yaml
├── .pre-commit-config.yaml
├── .prettierrc.yaml
├── .tool-versions
├── .vscode/tasks.json
├── AGENTS.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── repository.yaml
├── .github/
│   ├── ISSUE_TEMPLATE/{bug_report.yml,config.yml,feature_request.yml}
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── copilot-instructions.md
│   ├── renovate.json5
│   ├── settings.yml
│   ├── scripts/
│   │   ├── release-integrity.sh          (16.7 KB)
│   │   ├── release-integrity-test.sh     (11.6 KB)
│   │   └── repository-metadata.sh        (4.1 KB)
│   └── workflows/
│       ├── fro-bot.yaml
│       ├── hadolint.yaml
│       ├── main.yaml                     (18.6 KB)
│       ├── renovate.yaml
│       ├── scorecard.yaml
│       ├── update-repo-settings.yaml
│       └── workflow-lint.yaml
└── example/
    ├── CHANGELOG.md, DOCS.md, Dockerfile, README.md
    ├── apparmor.txt, config.yaml, icon.png, logo.png
    ├── rootfs/etc/services.d/example/{run,finish}
    ├── rootfs/usr/bin/my_program
    └── translations/en.yaml
```

**45 blobs** at `b7bcd528` (was 31 at `0a163c3f`). Removed: `.cursorrules` (→ `AGENTS.md` + `.github/copilot-instructions.md`, #576) and **`example/build.yaml`** (#580 — see *Build system*). Added: 3 issue/PR templates, 3 community health files, 3 shell scripts, 3 workflows, `AGENTS.md`, `CONTRIBUTING.md`, `.cortexkit/.gitignore`.

Add-on discovery is unchanged in principle — the HA store walks the repo root for directories containing `config.{json,yaml,yml}`, and `main.yaml`'s `prepare` job replicates that with `find ./ -maxdepth 2`. `AGENTS.md` now states the invariant explicitly: *"do not hardcode `example`."*

`.cortexkit/.gitignore` contains a fenced `cortexkit:magic-context` block ignoring `magic-context/` — the first observation of a `@cortexkit/*` plugin's state directory at **repository** level rather than in a user's `~/.config`, extending the [[marcusrbrown--dotfiles]] observation recorded in [[opencode-plugins]].

## The Example Add-on

`example/` is the template payload, demonstrating the canonical s6-overlay add-on structure.

- **`config.yaml`** — slug `example`, version **1.2.8** (was 1.2.2), arch **`aarch64` + `amd64`** (was four; `armhf`/`armv7` dropped in #564), `init: false`, `share:rw` map, single `message` option. Image is now **`ghcr.io/bfra-me/addon-example`** — the `{arch}-` prefix is gone, because the workflow derives per-arch build images internally and publishes a multi-arch manifest under the generic name. The file also gained ~35 commented-out option lines (#583) documenting every HA add-on key **with its risk annotation** inline (`full_access: true  # Grant Docker privileged mode; risk: near-unrestricted host access.`). Documenting a dangerous option and its blast radius in the same line is the right shape for a template — the forker meets the risk at the moment they uncomment the key, not in a doc they will not open.
- **`Dockerfile`** — now `FROM ghcr.io/home-assistant/base:3.24@sha256:93ef6078…`, a **single arch-agnostic digest-pinned base**. `ARG BUILD_FROM` is gone. `TEMPIO_VERSION` is **`2026.07.0`** (was `2024.11.2`).
- **`build.yaml`** — **deleted**. Per-arch base-image selection no longer exists as a concept.
- **`apparmor.txt`**, **`rootfs/`** (s6 service tree), **`translations/en.yaml`** — unchanged in shape.

### tempio: the 21-month freeze is over, the unverified fetch is not

The prior survey's headline supply-chain finding — `TEMPIO_VERSION=2024.11.2` against upstream `2026.07.0`, parked behind a `Pending Approval` dashboard checkbox because `versioning: loose` classifies a calver year rollover as a major — was resolved by **#577** on 2026-09-02. The Dependency Dashboard's `Pending Approval` section is now empty.

The *other* half of that finding stands verbatim: tempio remains the only artifact the add-on image downloads over the network at build time, and the fetch is still

```dockerfile
curl -sSLf -o /usr/bin/tempio \
  "https://github.com/home-assistant/tempio/releases/download/${TEMPIO_VERSION}/tempio_${BUILD_ARCH}"
```

— no checksum, no signature, no SRI equivalent, writing a binary to `/usr/bin` in an image the forker will publish and sign with cosign. Freshness was the tractable half and it got fixed; **integrity was the load-bearing half and it did not.** A digest-pinned base image plus a cosign-signed output around an unverified `curl` produces a supply chain that is cryptographically attested end-to-end *except* at the one point where bytes enter from outside. Recording this second time with the freshness excuse removed: the pin being current is now independent evidence that nobody addressed the verification gap while touching the exact line.

Minor curiosity, mechanism unconfirmed: the Dependency Dashboard lists `home-assistant/tempio 2026.07.0` **twice** under `regex`, both attributed to `example/Dockerfile`, suggesting two managers match the same declaration. Harmless today; worth knowing if a bump ever proposes itself twice.

## Build system: from one monolithic builder to composable actions

**Superseding the 2026-05-20 → 2026-08-31 description.** `main.yaml` was rewritten (#573) and is now 18.6 KB across nine jobs. Both pin holes this page tracked as open findings are closed.

- **`home-assistant/builder@2026.03.2`** (a mutable tag, in the only job holding `packages: write` + `id-token: write` + `--cosign`) → **`home-assistant/builder/actions/build-image@4de35182ce1e329181bffcbcc84d33db5e2c7e10 # 2026.06.0`**, SHA-pinned with a version comment, plus a sibling `actions/publish-multi-arch-manifest` at the same SHA. The retired top-level action is explicitly banned in `AGENTS.md`.
- **`chrisdickinson/setup-yq`** — **deleted**. The prior survey's recommendation was verbatim *"the cheapest remediation is deletion — `yq` is preinstalled on `ubuntu-latest`, and the two queries this job runs need no setup step at all."* That is what happened; `yq` is now invoked bare. No causal claim is made (the wiki is not read by this repo), but the repo's single untracked, unmaintained, abandonment-detector-invisible third-party dependency is gone.

Job graph at `b7bcd528`:

| Job | Purpose |
|---|---|
| `prepare` | Discover add-ons; `dorny/paths-filter@v4.0.3` against `MONITORED_FILES` (`apparmor.txt config.json config.yaml config.yml Dockerfile rootfs/**` — `build.yaml` removed); emit `build_matrix` + `manifest_matrix` as JSON |
| `lint-addon` | `frenck/action-addon-linter@v2.21.1` per changed add-on |
| `lint-prettier` | `creyD/prettier_action@v4.6`, Prettier **3.9.6** via `# renovate:` comment |
| `release-integrity` | `.github/scripts/release-integrity.sh` — version/CHANGELOG contract |
| `release-integrity-tests` | `.github/scripts/release-integrity-test.sh`, gated on `scripts_changed` |
| `repository-metadata` | `.github/scripts/repository-metadata.sh` — `repository.yaml` schema |
| `build-addon` | PR only, `contents: read`, `push: 'false'` |
| `publish-addon` | default-branch push only, `packages: write` + `id-token: write`, `push: 'true'`, cosign |
| `publish-manifest` | multi-arch manifest + **published-artifact verification** |

Three properties worth carrying forward:

**1. Native arm64 runners replace emulation.** The matrix maps `amd64 → ubuntu-24.04` and `aarch64 → ubuntu-24.04-arm`, with an explicit `::error::Unsupported architecture` default arm that fails the run rather than silently dropping an arch. The `armhf`/`armv7` removal (#564) is what makes this clean — there are no GitHub-hosted 32-bit ARM runners, so keeping those arches would have required retaining the QEMU path for a minority of targets. Dropping two published architectures is a **breaking change for any installed add-on on 32-bit hardware**, and it was approved in 25 minutes.

**2. Building and publishing are separated by permission, not by flag.** The old design ran one job with `--test` on PRs and full builds on push, meaning the PR path executed inside a job declaring `packages: write`. Now the fork-reachable job declares `contents: read` and cannot push by construction. This is the same shape as [[marcusrbrown--infra]]'s disjoint-capability job split: the attacker-reachable job is read-only, the privileged job is unreachable from a PR.

**3. The aggregators assert expected status, including expected `skipped`.** This is the repo's best new pattern and a direct descendant of the failure this page diagnosed in August. The `Lint` and `Build` jobs no longer just funnel results — they check them against what the event *should* have produced.

`Lint` tolerates a skip only where `prepare` said there was nothing to do:

| `lint-addon` result | `prepare.outputs.changed` | Verdict |
| --- | --- | --- |
| `skipped` | `false` | pass |
| `skipped` | `true` | **fail** — "Add-on lint was skipped despite Prepare reporting changed add-ons" |
| `success` | any | pass |
| anything else | any | **fail** |

with the same treatment for `release-integrity-tests` against `prepare.outputs.scripts_changed`, and unconditional `success` required from `prepare`, `lint-prettier`, `release-integrity`, and `repository-metadata`.

`Build` goes further with a `require_status` helper asserting the exact expected value per event — the pull-request path, verbatim:

```bash
require_status "build-addon"      "$BUILD_ADDON_RESULT"      "success"
require_status "publish-addon"    "$PUBLISH_ADDON_RESULT"    "skipped"
require_status "publish-manifest" "$PUBLISH_MANIFEST_RESULT" "skipped"
```

The push-to-default-branch path inverts all three (`skipped` / `success` / `success`), a `workflow_dispatch` on a non-default ref matches the PR shape, `prepare.outputs.changed == false` requires all three skipped, and an unrecognized event fails outright rather than falling through.

A skipped job is no longer implicitly passing; it is passing only where the event model says it must be skipped, and a *publish* job that unexpectedly ran on a pull request fails the gate. This is the correct general repair for "skipped ⇒ passing" — not narrowing triggers, but making the skip/run decision a checked invariant. It also catches the inverse (a job that should have been skipped and ran), which trigger-narrowing cannot. Cataloged in [[github-actions-ci]].

**4. Published artifacts are verified, not inferred.** `publish-manifest` ends with a step that runs `docker buildx imagetools inspect --raw` on the pushed reference, projects the declared `arch` list into expected `{os, architecture}` pairs (`amd64 → linux/amd64`, `aarch64 → linux/arm64`, anything else raising a jq `error()`), filters attestation entries via `select(.platform.os != "unknown" …)`, sorts both sides, compares them for string equality, and exits non-zero after printing `Expected platforms:` and `Published platforms:` on any difference.

Third fleet confirmation of *assert on the artifact, not the exit code* (after [[marcusrbrown--sparkle]]'s docs pipeline and [[marcusrbrown--mothership]]'s contract-first refusal clause), and the first where the assertion reads back from the **registry** rather than the local filesystem.

Other hygiene: workflow-level `permissions: contents: read`, `permissions: {}` on both aggregators, and `defaults.run.shell: bash --noprofile --norc -Eeuo pipefail {0}` — `pipefail` by default for every `run:` block, the remediation generalized in [[dotfiles]].

### Release integrity: a CI script with its own regression suite

`release-integrity.sh` (16.7 KB) enforces the contract *"`config.yaml` is the sole release-version source; its `version` must equal the top `## <version>` heading in the add-on's `CHANGELOG.md`"* — with a **hand-rolled full semver comparator in bash** (numeric-identifier normalization, prerelease precedence, build-metadata handling) so it can assert monotonic version increase, not just equality. `CONTRIBUTING.md` states the motivation precisely: *"The Supervisor resolves the image tag from `config.yaml`. Publishing a changed image under the existing version leaves installed add-ons pointing at the old image."* That is a real HA add-on failure mode — a silent no-op upgrade — and it is now a required check.

`release-integrity-test.sh` (11.6 KB) is a regression suite **for the CI script**, run only when `.github/scripts/**` changes, with the skip itself asserted by the `Lint` aggregator. A validation script complex enough to need a semver implementation is complex enough to need tests; wiring those tests to run exactly when the script changes, and proving the skip was legitimate, is the complete version of that instinct. Rare in this fleet.

`repository-metadata.sh` validates `repository.yaml` shape: required `name`, optional `url` as absolute http(s), optional non-empty `maintainer`, and a `::warning::` on unknown top-level keys.

**Its limit is structural and worth stating.** The template ships `repository.yaml` with `name: Your Repository Name` and `maintainer: Your Name <you@example.com>`, and the validator passes it — it checks shape, not identity. It cannot check identity, because a validator that rejects the placeholder would fail the template's own `main`. So the one failure mode that actually hurts a forker (shipping unchanged identity, or leaving `image: ghcr.io/bfra-me/addon-example` and publishing into someone else's namespace) is precisely the one a template cannot gate on itself.

The general shape: **a template repository cannot CI-enforce personalization without failing its own build, so personalization checks must be relative, not absolute.** Compare `repository.yaml`'s `url` against `github.repository`, or the configured `image` owner against `github.repository_owner` — both pass on `bfra-me` and fail on an unpersonalized fork. The README's HTML onboarding checklist and `AGENTS.md` Part II both *describe* the required edits; nothing verifies them. Carried forward from 2026-05-20, still open, now with a mechanism.

## Security scanning: from none to four gates

**Superseding the observation carried since 2026-05-20** ("No CodeQL, no Scorecard, no Trivy — security scanning is delegated to Renovate alerts and the Fro Bot autoheal sweep"). Three workflows landed in #572 and #578:

| Workflow | Tool | Trigger | Notes |
|---|---|---|---|
| `scorecard.yaml` | `ossf/scorecard-action@v2.4.4` | `push` main, weekly `35 7 * * 2`, `branch_protection_rule` | SARIF → code scanning via `github/codeql-action/upload-sarif@v4.37.9`; `publish_results: true`; `permissions: read-all` default |
| `hadolint.yaml` | `hadolint/hadolint-action@v3.5.0` | PR + push main | `recursive: true` |
| `workflow-lint.yaml` | `zizmorcore/zizmor-action@v0.6.4` (1.30.0) + `raven-actions/actionlint@v2.2.0` (1.7.12) | PR + push main | `min-severity: medium` |

Still absent: CodeQL *analysis* (the CodeQL action appears only as a SARIF uploader) and container image scanning (no Trivy/Grype). For a template shipping a Dockerfile, hadolint covers authoring defects but nothing scans the resulting image — the two-phase Trivy pattern from [[fro-bot--dashboard]] recorded in [[docker-containers]] would fit exactly here, and the digest-pinned `ghcr.io/home-assistant/base` is precisely the case that pattern exists to handle.

Per the 2026-09-15 autoheal report, 6 Scorecard code-scanning alerts are open and accepted as reviewed tradeoffs: `Security-Policy`, `CII-Best-Practices`, `Fuzzing`, and `Token-Permissions` ×3 on the `packages: write` publish jobs. Zero Dependabot alerts; Renovate reports no CVEs on osv.dev.

### Two suppressions that name their own invalidation condition

Both new suppressions in this repo are written the way a suppression should be, which is unusual enough to record. `renovate.yaml` carries an inline zizmor waiver:

```yaml
  # Runs a full Renovate pass once Main succeeds on the default branch. The
  # called workflow grants only contents: read, checks out no ref … and uses
  # event body text only inside contains() predicates — so the privilege
  # escalation this audit exists to catch has no path here. Re-check when the
  # pinned SHA below changes.
  workflow_run: # zizmor: ignore[dangerous-triggers]
```

It states the threat model, enumerates why each leg does not apply, and **names the condition that invalidates it** — a SHA change in the called workflow. `settings.yml` does the same for an omission:

```yaml
        # Scorecard is deliberately absent: it runs on push/schedule only, never on
        # pull_request, so requiring it would block every pull request permanently.
        contexts: ['Prepare', 'Lint', 'Build', 'Actionlint', 'Hadolint', 'Zizmor', 'Renovate / Renovate', 'Fro Bot']
```

Contrast [[marcusrbrown--sparkle]]'s `skipErrorChecking: true`, a blind suppressor that made a wrong artifact invisible for an unknown duration. The difference is not discipline, it is falsifiability: a waiver that names its expiry can be linted; one that names nothing is permanent by default. Cataloged in [[github-actions-ci]].

## The Fro Bot workflow

- **Agent:** `fro-bot/agent@5494812ab3b9a96573e9807e99f7fdfdd5d92e81 # v0.112.0` (was v0.43.1 — a ~69-minor crossing landed in three hops: v0.107.0 #557, v0.107.1 #584, v0.112.0 #591). PR **#597** proposes v0.112.1.
- **Triggers:** unchanged — `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (5 types), `schedule` `30 15 * * *`, `workflow_dispatch` with a required `prompt`.
- **Hardening (new):** workflow-level `permissions: contents: read`; checkout at `persist-credentials: false` (#586); a **fork guard** (`!github.event.pull_request.head.repo.fork`) in addition to the existing bot-author and `OWNER`/`MEMBER`/`COLLABORATOR` association guards; `concurrency` keyed on issue/PR/discussion number with `cancel-in-progress: false`.
- **`PR_REVIEW_PROMPT`** — still add-on-aware (Dockerfile base pinning, shell quality with named shellcheck codes, AppArmor integrity, Actions SHA pinning, breaking add-on-interface changes, translation completeness) with a mandatory `PASS | CONDITIONAL | REJECT` verdict structure. Updated for the build system change: `config.yaml/build.yaml` → `config.yaml / Dockerfile`.
- **`SCHEDULE_PROMPT`** — four categories (errored PRs / security / health & maintenance / developer experience) plus the SINGLE ISSUE MANAGEMENT block. **Not** updated for the build system change.

### Stale prompt constants degraded gracefully — a useful contrast

`SCHEDULE_PROMPT` category 3 still instructs the agent to compare SHAs for **`chrisdickinson/setup-yq`** (deleted in #573) and still says *"bfra-me/.github reusable workflow version (currently v4.16.6)"* — a literal this page has flagged as drifting since 2026-05-30, now ~23 minor versions stale against the actual v4.29.0.

The 2026-09-15 report shows the agent handling both cleanly:

> `chrisdickinson/setup-yq` (not present as a direct dep in this repo's workflows) … `bfra-me/.github` reusable workflow is already at **v4.29.0** on `main` (well ahead of the v4.16.6 baseline in this task's static instructions — no update needed)

It names the static instruction as static, checks reality, and reports the delta. This **contradicts the expected outcome** in the [[marcusrbrown--dotfiles]] dormant-configuration finding, where a Fro Bot prompt carrying dead conventions *kept recommending them as live*. Same input class, opposite result. The discriminator is visible in the prompt text: these clauses pair each hardcoded constant with an instruction to *"compare against current SHAs"* and *"check if a newer version is available"* — dynamic verification with the constant as a hint. Dotfiles' dead conventions were stated as facts with nothing to check them against.

Rule: **a stale constant is harmless when the prompt also names the authority that supersedes it, and load-bearing when it is the only authority.** That is a writable prompt-engineering property, not luck. It does not make the drift acceptable — a dead reference costs tokens and invites a less careful model to act on it — but it reclassifies the risk from *incorrect output* to *wasted work*.

### The perpetual issue has no rotation clause and is still writable at 68,793 characters

Issue **#554** `Daily Autohealing Report` (`fro-bot`, opened 2026-04-18) carries a **68,793-character** body and 35 comments, with 16 dated `## Update — YYYY-MM-DD` sections prepended newest-first. The `SCHEDULE_PROMPT`'s SINGLE ISSUE MANAGEMENT block says `ALWAYS prepend new updates to existing content` and `DO NOT close the perpetual issue` — and specifies **no rotation, archival, or size bound at all**. Unbounded growth is the designed behavior.

This **corrects a hypothesis carried at [[marcusrbrown--cortexkit-anthropic-auth]]**, where a perpetual issue at **54,813** characters against a prompt directive to rotate at 50,000 was the proximate suspect for a daemon that ran green for six weeks while writing nothing. This repo's issue is **25% larger**, has no directive to violate, and writes succeeded as recently as the most recent scheduled run. So issue-body size in the 50–70 KB range is **not** on its own sufficient to stop a write, and the cortexkit stall needs a different explanation. Recorded here rather than rewriting that page, per the additive rule; that page's finding stands as an observation and falls as a mechanism.

The update headings preserve the outage as a visible hole: `2026-09-15, 09-14, 09-12, 09-11, 09-10, 09-09, 09-08, 09-07, 09-05, 09-04, 09-04, 09-02, 09-02, 09-01`, then a gap to `2026-08-12, 08-11`. The 08-13 → 08-31 silence is legible in the artifact itself — better provenance than most of this fleet's daemons leave behind.

## Documentation: `AGENTS.md` learns the template's actual problem

`.cursorrules` (Cursor-specific, single-audience) was replaced by **`AGENTS.md`** (10.8 KB) and `.github/copilot-instructions.md` (#576). The structural move is the interesting part:

> This file has two deliberately separate audiences. Apply only the part that matches the repository you are editing.
>
> **Part I — Maintaining this template** … **Part II — Working in a repository created from this template**

Every agent-instruction file in a template repository is copied into every fork, where roughly half its content is not merely stale but **actively wrong** — "do not hardcode `example`" is right for both audiences; "changes here propagate to repositories created from the template" is right for exactly one. Splitting by audience and telling the reader to select is the correct resolution, and this is the first instance of it observed in the fleet.

`SECURITY.md` applies the same insight to disclosure: *"Use GitHub private vulnerability reporting on the repository you are actually using … Do not report a fork's vulnerability to the template's upstream repository,"* plus a note that fork owners must enable PVR themselves. **A template artifact must state which repository it is about** is the durable principle running through this interval, and the repo appears to have internalized it deliberately rather than stumbled into it.

`AGENTS.md` also does something rarer — it records a known-broken subsystem in its own Notes section:

> `.github/settings.yml` application is intermittently failing; see issue #569 and the upstream blocker `bfra-me/.github#2667`. Branch protection may need to be applied by hand until that lands.

### Documentation drift, twelve nights and counting

Three drifts, all confirmed by direct read and all independently found by the daemon:

| Claim | Location | Actual |
|---|---|---|
| Python `3.13.13` | `AGENTS.md`, `CONTRIBUTING.md` | `.tool-versions` → **3.13.15** (#562, 2026-09-02) |
| `npx prettier@3.8.3` | `AGENTS.md`, `CONTRIBUTING.md` | `main.yaml` `PRETTIER_VERSION` → **3.9.6** (#574, 2026-09-02) |
| 5 required checks | `AGENTS.md` ("Do not rename the required `main` checks: `Prepare`, `Lint`, `Build`, `Renovate / Renovate`, and `Fro Bot`") | `settings.yml` and `CONTRIBUTING.md` both list **8** (+ `Actionlint`, `Hadolint`, `Zizmor`) |

The third is not staleness — `AGENTS.md` and `CONTRIBUTING.md` were authored 21 hours apart (#576 at 09-02T04:27, #581 at 09-02T19:56) and disagree with each other about the required check set. Two documents in one repo, one window, contradictory.

The Prettier drift is the one with teeth. Both documents tell a contributor to run `npx prettier@3.8.3 --check` locally while the required `Prettier` check runs **3.9.6**. Prettier minor releases change formatting output; a contributor following the documented command can get a clean local check and a red gate, or format to 3.8.3's output and be rejected. **A documented local verification command pinned to a different version than the gate it is supposed to predict is worse than no documented command** — it converts an unknown into a confident wrong answer. Same class as [[marcusrbrown--marcusrbrown-com]]'s stale Stack line, but here the stale value is executable.

The fix is four lines across two files, the daemon has produced it correctly twelve nights running, and it cannot land it. See *The agent can no longer deliver*.

## Configuration

### Renovate (`.github/renovate.json5`)

- Extends **`github>bfra-me/renovate-config#5.2.7`** (was `#5.2.1`, via #561) plus `:enablePreCommit`. Still a different preset family from the `marcusrbrown/renovate-config` line used across the rest of the ecosystem.
- Package rules unchanged in shape: HA base images grouped with `pinDigests: false`; `hassio-addons` grouped; `home-assistant/actions/*` grouped; `home-assistant/builder` with custom `extractVersion` + `separateMajorMinor: false` + `separateMinorPatch: false`; `python` capped at `<=3.13`.
- **The `alpine_3_20` custom-manager bug is fixed.** `depNameTemplate` is now **`alpine_3_24/{{package}}`**, matching the current base image tag. The prior survey flagged this as inert-but-wrong: syntactically valid, semantically aimed three Alpine releases behind the image, and live the moment a forker adds their first `apk add pkg=x.y.z` pin. It is still inert (`example/Dockerfile` has no apk pins) but now correctly targeted. The *class* of defect persists structurally — the branch is hardcoded in the manager and the base image tag is in the Dockerfile, so the next base bump reintroduces the mismatch. Templating it off the base tag, or a lint comparing the two, is the durable fix.

### Dependency Dashboard (issue #4) — the backlog is gone

The 2026-08-31 reading was a **fixed 5-PR window (`prConcurrentLimit`) over a 6-deep rate-limited backlog plus 2 approval-gated majors**. At 2026-09-15 the `Rate-Limited` and `Pending Approval` sections do not exist. Four open PRs, all opened 09-09 → 09-14, oldest six days:

| PR | Opened | Target |
|---|---|---|
| #592 | 2026-09-09 | `ghcr.io/zizmorcore/zizmor` → v1.30.1 |
| #594 | 2026-09-09 | `github/codeql-action` → v4.38.0 |
| #596 | 2026-09-14 | `home-assistant/builder` → 2026.09.0 |
| #597 | 2026-09-14 | `fro-bot/agent` → v0.112.1 |

This retroactively confirms the `prConcurrentLimit: 5` reading. The window was never the backlog; drain the backlog and the window stops being load-bearing.

Two live problems remain on the dashboard:

- **Repository Problems:** `⚠️ WARN: Error updating branch: update failure`, with an `Errored` entry for `chore(deps): pin (digest) ghcr.io/zizmorcore/zizmor Docker tag to 1ba0035`. Renovate discovers `ghcr.io/zizmorcore/zizmor 1.30.0` from the `version:` **input** of `zizmorcore/zizmor-action` in `workflow-lint.yaml` — a plain version string, not an image reference. A `pinDigests` rule that fires on a docker-datasource dep whose only textual home is a version-string input has nowhere valid to write the digest. **Hypothesis, unverified** — the error body is not exposed on the dashboard. If it holds, the fix is a `pinDigests: false` rule scoped to that dep.
- **Abandoned Dependencies (2, unchanged):** `creyD/prettier_action` (last release 2025-06-09) and `pre-commit/pre-commit-hooks` (2025-08-09). The first is still the repo's **entire Prettier gate** — one of the jobs feeding the required `Lint` check — and the hardening sweep that added four security gates did not touch it. `pre-commit-hooks` is still pinned at `v6.0.0`; note the 2026-09-15 autoheal report calls it *"confirmed still the latest upstream release,"* which is true and orthogonal to abandonment.

### What Renovate still cannot see

`.tool-versions` contains two lines. The dashboard's `asdf (1)` section lists exactly one: `python 3.13.15`. **`node 22.11.0` is invisible** — re-verified against the live detected-dependency listing, and still two majors behind the fleet baseline (Node 24.19/24.20 at [[bfra-me--works]], [[marcusrbrown--dotfiles]]). Python moved (#562); Node has no update path at all and has not moved in nine surveys. `AGENTS.md` and `CONTRIBUTING.md` both document `22.11.0` as the repository's Node version, so the value is load-bearing documentation for a pin nothing can advance.

### Probot Settings (`.github/settings.yml`)

- Extends `.github:common-settings.yaml` (resolves to `bfra-me/.github`, not Marcus's personal `.github`).
- Repo: `is_template: true`, topics, description.
- Branch protection on `main`: strict required status checks, now **8 contexts** — `Prepare`, `Lint`, `Build`, **`Actionlint`**, **`Hadolint`**, **`Zizmor`**, `Renovate / Renovate`, `Fro Bot` (#578) — `enforce_admins: true`, 1 required approving review, dismiss stale reviews, `required_linear_history: true`, no code-owner requirement, no restrictions.
- **Applied state unverified** as of 2026-09-15 — see #569 above. The manifest is current; whether `main` reflects it is not established.

### Tooling

- **`.tool-versions`:** Node **22.11.0** (unchanged, untracked), Python **3.13.15**.
- **`.pre-commit-config.yaml`:** `pre-commit/pre-commit-hooks` `v6.0.0`, four hooks, flagged abandoned.
- **`.devcontainer.json`**, **`.markdownlint-cli2.yaml`**, **`.prettierrc.yaml`**, **`.vscode/tasks.json`** (single `supervisor_run` task) present.
- **`.gitattributes`** marks `*.json` as JSON-with-comments for linguist; its `.cursorrules` entry is now dead (file removed).

## Actions Run Storm: abated, and not by the recommended fix

Run totals at 2026-09-15:

| Workflow | Runs | Latest |
|---|---|---|
| `renovate.yaml` | **40,000** | 2026-09-15T07:43 `success` |
| `fro-bot.yaml` | 8,731 | 2026-09-14T19:58 `skipped` (`issue_comment`) |
| `main.yaml` | 996 | 2026-09-14T18:33 `success` |
| `update-repo-settings.yaml` | 621 | 2026-09-14T19:24 `success` |
| `hadolint.yaml` / `workflow-lint.yaml` | 128 each | 2026-09-14T18:33 `success` |
| `scorecard.yaml` | 45 | 2026-09-14T19:24 `success` |

**Measurement correction.** The 2026-08-31 survey reported "Total Actions runs across all four workflows: **40,000**." That figure is now attached to `renovate.yaml` **alone**, unchanged and still exactly round across 15 days of continuous triggering. An exactly-round `total_count` that does not move between surveys is a **cap, not a count**. The prior page's 40,000 was not a measurement and the derived claim ("40,000 runs on a 31-blob template") should not be relied on. `fro-bot.yaml`'s 8,731 is below any cap and is trustworthy. Recorded in [[github-actions-ci]] as a measurement-hygiene rule.

**The storm itself is over.** `Fro Bot` went 8,471 → 8,731 in 15 days ≈ **17 runs/day**, against roughly **750/day** at the late-August peak (6,872 → 8,378 between 08-26 and 08-28). A ~44× reduction.

The trigger configuration did not change. `fro-bot.yaml` still fires on `issues: [opened, edited]`, and `renovate.yaml` still fires on `issues.edited` and `pull_request.edited`. The prior survey's recommendation — narrow the trigger or gate at workflow level — was not taken, and the storm stopped anyway, because the *source* stopped: with the queue drained from 5-over-11 to 4-with-no-backlog, Renovate stopped constantly rewriting the Dependency Dashboard and retargeting PR bodies.

That is a genuine refinement. The amplifier was real (a job-level `if:` boots a runner before it can skip; GitHub offers no event-level bot filter), but the amplifier was not the cause. **A self-amplifying no-op loop between a bot's own artifacts and its own triggers is bounded by the bot's churn rate, and churn rate is a function of backlog depth.** Fix the governance stall and the run count falls out. The trigger narrowing is still worth doing — it caps the worst case rather than relying on the queue staying short — but it was treating a symptom.

## Cross-Ecosystem Notes

| Aspect | bfra-me/ha-addon-repository (2026-09-15) | [[marcusrbrown--ha-config]] |
|---|---|---|
| Purpose | Template for building & publishing HA add-ons | Running HA config (consumes add-ons & components) |
| Renovate base | `bfra-me/renovate-config#5.2.7` | `marcusrbrown/renovate-config#4.5.x` |
| Probot extends | `.github:common-settings.yaml` (bfra-me org) | `fro-bot/.github:common-settings.yaml` |
| Fro Bot agent | **v0.112.0**, running green, **delivering nothing** | **Not present** (carried-forward recommendation) |
| Fro Bot issue model | Single perpetual `Daily Autohealing Report` (#554, 68,793 chars, no rotation clause) | n/a |
| Build target | 2-arch native-runner Docker builds → GHCR, cosign, manifest verified | n/a |
| HA validation tool | `frenck/action-addon-linter` | `frenck/action-home-assistant` |
| Security scanning | Scorecard + hadolint + zizmor + actionlint | Renovate alerts only |

The two `frenck/action-*` tools are siblings serving the two sides of HA development: linter for the add-on contract, home-assistant for the running config. See [[home-assistant]].

**Fleet position after this interval.** This repo now runs a stricter CI gate than most `marcusrbrown/*` repos — status-asserting aggregators, registry-readback verification, four security scanners, a tested validation script, and least-privilege job splits — while being the *only* surveyed repo whose agent has a working read path and a severed write path documented in its own nightly output. Sophisticated gate, severed daemon. The instrumentation and the actuation moved in opposite directions in the same fortnight.

## Observations

- **Template hygiene, still unenforced:** the README's onboarding list and `AGENTS.md` Part II both describe the required fork edits (rename `example/`, set `image` to `ghcr.io/<owner>/addon-<slug>`, update `repository.yaml`, bump `version` with `CHANGELOG.md`). `repository-metadata.sh` validates shape only. A relative check (`repository.yaml` `url` vs `github.repository`; image owner vs `github.repository_owner`) would pass upstream and fail an unpersonalized fork — see *Release integrity* above.
- **`enforce_admins: true`** on a template means forks inherit a strict policy the solo maintainer must also follow. This repo just demonstrated the cost empirically: 107 days.
- **The example add-on's option documentation is the best artifact in the tree.** Every dangerous HA key is commented out with its risk stated on the same line. Risk annotation at the point of use beats a security doc nobody opens.
- **Open-issue count is no longer purely a governance artifact.** For eight surveys `open_issues_count` was the parked PR queue plus two bot issues. It is now 4 PRs + 3 issues, one of which (#569) is a real human-filed defect report with a control-repo comparison and a hand-replayed API call in it.
- **`home-assistant/builder` is at 2026.06.0 with 2026.09.0 open (#596).** Now SHA-pinned, so a bump is an explicit immutability change rather than a string edit.

## Survey History

| Date | SHA | Notes |
|---|---|---|
| 2026-05-20 | `0a163c3f` | Initial survey. Fro Bot agent v0.43.1, four workflows, example add-on at v1.2.2, HA base images Alpine 3.22/3.23, Node 22.11.0, Python 3.13.13. |
| 2026-05-30 | `0a163c3f` | HEAD unchanged 14 days. Open issues 5 → 6. 4 open Renovate PRs queued and unmerged: #556 (`bfra-me/.github` v4.16.16 → v4.16.21), #557 (`fro-bot/agent` v0.43.1 → v0.46.1), #558 (HA `amd64-base:3.23` digest), #559 (`docker/login-action` v4.2.0). `SCHEDULE_PROMPT` references `bfra-me/.github` "currently v4.16.6" — stale relative to the actual v4.16.16 import. No content drift. |
| 2026-06-10 | `0a163c3f` | HEAD unchanged 25 days (last merge #551, 2026-05-16). Queue grew to 5: #556 → v4.16.24, #557 → v0.59.1 (16-minor jump), #558, #559, new #560 (`actions/checkout` v6.0.3). All green but `REVIEW_REQUIRED`. #554 updating daily; escalated to assigning "Tasks for Copilot". |
| 2026-06-20 | `0a163c3f` | HEAD frozen 35 days. #556 → v4.16.27, #557 → v0.72.0 (~29-minor jump), #558 → HA Add-ons v3.24, #559/#560 unchanged. The review-required deadlock is the dominant fact: CI green, bottleneck purely human/governance. |
| 2026-07-02 | `0a163c3f` | HEAD frozen 47 days. #556 → v4.16.33, #557 → v0.81.0 (~38-minor jump), #559 → v4.3.0. Live checks confirm green-but-blocked; add-on lint/build SKIPPED, `Fro Bot` SKIPPED. |
| 2026-07-16 | `0a163c3f` | HEAD frozen 60 days. #556 → v4.16.37, #557 → v0.92.1 (~49-minor jump), #559 → v4.4.0. Survey ran without a `gh` token (unauthenticated API + raw). |
| 2026-08-07 | `0a163c3f` | HEAD frozen 83 days. #556 → v4.16.44, #557 → v0.96.3 (~53-minor jump), #559 → v4.6.0, #560 → v6.1.0. `open_issues_count` 7 steady across the entire deadlock. Unauthenticated survey. |
| 2026-08-31 | `0a163c3f` | HEAD frozen **107 days**; tree byte-identical (31 blobs). **Two firsts.** (1) Daily autoheal daemon dead — 17 consecutive scheduled `failure` since 2026-08-14, last success 08-13 matching #554's last update; failure in `Run Fro Bot` (`agent@v0.43.1`) ~2 min in; root cause unconfirmed. Unnoticed because `Fro Bot` as a required check is evaluated on `pull_request` where the bot guard makes it skip (⇒ passing). (2) PR #556 autoclosed unmerged after 106 days; update demoted to a Rate-Limited dashboard checkbox. New #561 took the slot (first queue-composition change since 05-22); #557 → v0.107.0 (~64-minor jump). Dashboard reveals a fixed 5-PR window (`prConcurrentLimit`) over a 6-deep rate-limited backlog + 2 approval-gated majors (`actions/checkout` v7; `home-assistant/tempio` **v2026** vs pinned 2024.11.2, ~21 months stale, the image's only network-fetched build artifact). New **Abandoned Dependencies** section flags `creyD/prettier_action` and `pre-commit/pre-commit-hooks`. Supply-chain findings: `chrisdickinson/setup-yq` invisible to Renovate entirely; `home-assistant/builder@2026.03.2` tag-pinned in the cosign/`packages: write` job; `repology` manager pointed at `alpine_3_20` against 3.23/3.22 images. Run storm: ~1,500 no-op runs in two days from `issues.edited` × dashboard rewrites. |
| **2026-09-15** | **`b7bcd528`** | **The deadlock broke and the repo was rebuilt.** `marcusrbrown` approved #557 at **2026-09-01T02:13** after **107 days**; 34 commits followed in 14 days (bot 16 / **human 15** / fro-bot 3), tree **31 → 45 blobs**, workflows **4 → 7**. **Review latency tracks reviewer presence, not risk** — #557 (`+1/-1`) waited 107 days; #564 (agent-authored, *drops two published architectures*, 7 files) was approved and merged in **25 minutes**. **Correction:** the daemon recovered at **2026-08-31T20:54** on unchanged HEAD, ~6 h before any commit — the outage was transient, and the prior page's stale-harness root cause is **superseded**. **Every open supply-chain finding closed:** `setup-yq` deleted, `home-assistant/builder` SHA-pinned and split into composable `build-image`/`publish-multi-arch-manifest`, `alpine_3_20` → `alpine_3_24`, `tempio` 2024.11.2 → **2026.07.0** — but the unverified `curl` that installs tempio is untouched, so freshness was fixed and **integrity was not**. Build system rewritten: `build.yaml` deleted, single arch-agnostic digest-pinned base, arch 4 → 2, **native `ubuntu-24.04-arm`** instead of QEMU, build/publish separated by permission, and two new patterns — **aggregators that assert expected `skipped` vs `success` per event** (`require_status`, the correct repair for "skipped ⇒ passing") and **registry readback verification** (`docker buildx imagetools inspect` platform assertion; 3rd fleet confirmation of *assert on the artifact*). Security scanning none → **four gates** (Scorecard, hadolint, zizmor, actionlint) with two model suppressions that name their own invalidation conditions. `.cursorrules` → **two-audience `AGENTS.md`** (Part I template / Part II fork) + `SECURITY.md` telling forkers not to report to upstream — *a template artifact must state which repository it is about*. **Three new problems.** (1) **The agent runs green and delivers nothing** — last artifact 09-01T03:29, then 13 green scheduled runs and zero output; its report states delivery mode `working-dir` expecting "the caller workflow to diff, commit, and open" a PR, but `fro-bot.yaml` ends at `Run Fro Bot`; it has re-applied the same 4-line doc fix **12 consecutive nights** and says so in its own ⚠️ line (3rd instance of the class after [[marcusrbrown--tokentoilet]]). (2) **#569** — `.github/settings.yml` sync fails intermittently with an empty error body, and **push-triggered runs are green by design** because `paths-filter` skips the apply step; the agent's first triage blamed the nearest recent PR and was corrected on-thread by the human with control-repo evidence; branch-protection applied state **unverified** (401). (3) **Doc drift with teeth** — `AGENTS.md`/`CONTRIBUTING.md` document `npx prettier@3.8.3` against a **3.9.6** gate, Python 3.13.13 against 3.13.15, and `AGENTS.md` lists 5 required checks where `settings.yml`/`CONTRIBUTING.md` list 8 (authored 21 h apart, mutually contradictory). Also: third repo in the `tar` outage (inert ≈ **6h01m**; the three fleet hand-fixes landed 22:56 / **22:57** / 23:01 — one operator, five minutes), with `update-repo-settings.yaml` deliberately left on the poisoned ref for **10 days** — *minimum-viable fix ≠ complete fix*. Queue drained to 4 fresh PRs (no Rate-Limited, no Pending Approval), and the **run storm abated ~44×** without the recommended trigger change — draining the backlog removed the churn that fed it. Corrections: `renovate.yaml`'s **40,000** `total_count` is a **cap, not a count**; #554 at **68,793 chars** still writes fine, which **falsifies the issue-body-size mechanism** hypothesized at [[marcusrbrown--cortexkit-anthropic-auth]]. Unauthenticated survey (no `gh` token). |

## Drift Watch

- **Delivery break (new 2026-09-15, highest priority):** `fro-bot.yaml` requests `working-dir` output and has no commit/push/PR step. The agent has produced a correct 4-line fix twelve nights running and landed none of it. Fix: adopt [[marcusrbrown--sparkle]]'s `Resolve delivery mode` pattern — one computed step feeding both the agent's `output-mode` and a conditional credential restore — so the delivery decision and the credential cannot disagree. Do **not** simply re-enable `persist-credentials` without the delivery half; that reintroduces the credential exposure #586 removed and still delivers nothing.
- **`SCHEDULE_PROMPT` dead references (carried since 2026-05-30, now partly orphaned):** the `bfra-me/.github` "currently v4.16.6" literal is ~23 minors stale, and category 3 still names `chrisdickinson/setup-yq`, deleted in #573. Both degrade gracefully because the same clauses instruct dynamic lookup (see *Stale prompt constants*), so this is wasted work rather than wrong output — but the `PR_REVIEW_PROMPT` was updated for the build system change and the `SCHEDULE_PROMPT` was not, so the file is now internally inconsistent about which build system it describes.
- **Executable doc drift (new 2026-09-15):** `npx prettier@3.8.3` in `AGENTS.md` and `CONTRIBUTING.md` against a `3.9.6` gate. A documented local check that predicts the gate incorrectly is worse than none. Fix alongside the Python `3.13.13` → `3.13.15` correction and the 5-vs-8 required-check contradiction.
- **Unverified network fetch in the image (carried, now unexcused):** `curl -sSLf` of the tempio binary into `/usr/bin` with no checksum or signature, inside an image the build then cosign-signs. The version is current as of #577, which removes the "it is stale anyway" framing and isolates the integrity gap. Fix: publish/verify a SHA-256 alongside `TEMPIO_VERSION`, or vendor the binary.
- **`.github/settings.yml` is not a reliable actuator (new 2026-09-15):** issue #569, upstream `bfra-me/.github#2667`. Failures are unretried and unlogged; push-triggered runs are green while skipping the apply step. Until the upstream retry + error-body logging lands, treat branch protection as hand-applied and verify after every change. Applied state currently unverified. See [[probot-settings]].
- **`alpine_3_24` will drift again (revised 2026-09-15):** the `repology` manager's branch is hardcoded and the base image tag lives in the Dockerfile. Correct today (3.24 = 3.24); wrong the next time the base image bumps and nobody edits the manager — the exact failure this page recorded in August at `alpine_3_20`. Fix the class, not the value: template the branch off the base tag or lint the two for equality.
- **`node 22.11.0` has no update path (carried, nine surveys):** invisible to Renovate's asdf manager (which detects only the `python` line), two majors behind the fleet, and documented as authoritative in two contributor-facing files. A `# renovate:` annotation or an explicit asdf manager config would make it tractable.
- **`creyD/prettier_action` is an abandoned action holding a required check (carried):** last release 2025-06-09; four new security gates landed around it without touching it. Prettier is a one-line `npx` invocation; the action buys nothing that justifies an unmaintained dependency in the `Lint` path.
- **Renovate `update failure` on the zizmor digest pin (new 2026-09-15):** a dashboard-level `Repository Problems` warning plus an `Errored` entry. Hypothesis: a `pinDigests` rule firing on a docker-datasource dep whose only textual home is a workflow `version:` input, leaving nowhere valid to write a digest. Unverified — the error body is not exposed. A scoped `pinDigests: false` is the likely fix.
- **Template personalization is still unenforced (carried since 2026-05-20, now with a mechanism):** `repository-metadata.sh` validates shape, not identity, and structurally cannot validate identity absolutely without failing the template's own build. Use relative checks against `github.repository` / `github.repository_owner`.
