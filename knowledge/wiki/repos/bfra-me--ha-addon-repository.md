---
type: repo
title: bfra-me/ha-addon-repository
created: 2026-05-20
updated: 2026-05-20
sources:
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-05-20
tags: [home-assistant, addon, hassio, template, docker, multi-arch, bfra-me]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - marcusrbrown--containers
  - bfra-me--renovate-action
  - home-assistant
  - docker-containers
  - github-actions-ci
  - probot-settings
---

# bfra-me/ha-addon-repository

Template repository for a Home Assistant add-on repository. GitHub template (`is_template: true`) under the `bfra-me` org, used as the blueprint when starting a new HA add-on collection. The repo ships one example add-on (`example/`) that gets built and published to GHCR as `ghcr.io/bfra-me/{arch}-addon-example`.

This is the bfra-me ecosystem's add-on counterpart to Marcus's runtime [[marcusrbrown--ha-config]] — where ha-config consumes add-ons and integrations, this repo defines the scaffolding for building and publishing new ones.

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public, template
- **License:** Apache-2.0
- **Default branch:** `main`
- **Primary language:** Dockerfile
- **Topics:** `addon`, `addons`, `hassio`, `home-assistant`, `homeassistant`, `template`
- **Created:** 2022-10-08
- **Last push:** 2026-05-20

## Layout

```
.
├── .github/
│   ├── renovate.json5
│   ├── settings.yml
│   └── workflows/
│       ├── fro-bot.yaml
│       ├── main.yaml
│       ├── renovate.yaml
│       └── update-repo-settings.yaml
├── .cursorrules
├── .devcontainer.json
├── .markdownlint-cli2.yaml
├── .pre-commit-config.yaml
├── .prettierrc.yaml
├── .tool-versions
├── LICENSE
├── README.md
├── example/
│   ├── CHANGELOG.md
│   ├── DOCS.md
│   ├── Dockerfile
│   ├── README.md
│   ├── apparmor.txt
│   ├── build.yaml
│   ├── config.yaml
│   ├── icon.png
│   ├── logo.png
│   ├── rootfs/
│   └── translations/
└── repository.yaml
```

The HA add-on store discovers add-ons by walking the repo root for directories containing a `config.yaml`/`config.json`. The `Main` workflow's `prepare` job replicates that discovery with `find ./ -maxdepth 2 -name config.json -o -name config.yaml -o -name config.yml`.

## The Example Add-on

`example/` is the template payload. It demonstrates the canonical s6-overlay add-on structure:

- **`config.yaml`** — slug `example`, version `1.2.2`, four arches (`armhf`, `armv7`, `aarch64`, `amd64`), `init: false` (s6 takes over), `share:rw` map, single `message` option, image `ghcr.io/bfra-me/{arch}-addon-example`.
- **`build.yaml`** — base images pinned to `ghcr.io/home-assistant/{arch}-base:3.23` for 64-bit, `:3.22` for 32-bit ARM. OCI labels set title, description, source URL, and Apache-2.0 license.
- **`Dockerfile`** — `ARG BUILD_FROM` pinned by digest (`@sha256:...`) so Renovate can rotate it. Installs `tempio` (HA's template renderer) from `home-assistant/tempio` GitHub releases with a Renovate datasource comment. Copies `rootfs/` over the base image.
- **`apparmor.txt`** — AppArmor profile (security mandatory for HA add-ons).
- **`rootfs/`** — s6-overlay service tree.
- **`translations/`** — i18n strings for the HA Supervisor UI.

## Workflows

Four workflows, all SHA-pinned actions:

### `main.yaml` — CI lint + multi-arch build
- **Trigger:** `pull_request` (main), `push` (main), `workflow_dispatch`.
- **`prepare` job:** Discovers add-on directories, uses `dorny/paths-filter@v4.0.1` to compute changed add-ons against a `MONITORED_FILES` list (`apparmor.txt build.yaml config.yaml Dockerfile rootfs/**`). Emits JSON arrays for downstream matrix expansion.
- **`lint-addon` matrix:** `frenck/action-addon-linter@v2.21.0` per changed add-on. Authoritative HA lint.
- **`lint-prettier`:** `creyD/prettier_action@v4.6`, Prettier 3.8.3 pinned via `# renovate: datasource=npm depName=prettier` comment, `--check .`.
- **`build-addon` matrix:** Per-changed-add-on × (`aarch64`, `amd64`, `armhf`, `armv7`). Uses `yq` (`chrisdickinson/setup-yq` v4.45.1) to extract `build_from` keys and validate the arch list before building. `home-assistant/builder@2026.03.2` runs with `--test` for PRs and full builds with `--cosign` on push to `main`. Publishes to `ghcr.io/bfra-me/{arch}-addon-{slug}` with `id-token: write` (Sigstore/cosign).
- **`lint`/`build` aggregator jobs** funnel matrix results into single named status checks for branch protection.

### `fro-bot.yaml` — Fro Bot agent integration
- **Agent version:** `fro-bot/agent@v0.43.1` (SHA `3ec8d72f`).
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/reopened/ready_for_review/review_requested), `schedule` (`30 15 * * *` — daily 15:30 UTC), `workflow_dispatch` with `prompt` input.
- **Bot-loop guards:** Skips when the user, comment author, or PR author ends with `[bot]` or equals `fro-bot`. Comment triggers require `OWNER`/`MEMBER`/`COLLABORATOR` association and `@fro-bot` mention.
- **PR_REVIEW_PROMPT** is add-on-aware: Dockerfile base-image SHA pinning, `config.yaml`/`build.yaml` validity (required fields, arch list accuracy, image reference pattern), shell script quality (`bashio`, signal handling, shellcheck SC2086/SC2060), AppArmor profile integrity, GitHub Actions SHA pinning, YAML formatting, breaking changes to add-on interface (slug/image/option-type changes that break existing installs), translation completeness. Output is a structured verdict (`PASS | CONDITIONAL | REJECT`) with mandatory headings.
- **SCHEDULE_PROMPT** runs a four-category sweep: errored PRs (checkout, diagnose, fix, push), security (Renovate alerts, SHA-pinning audit of `.github/workflows/*.yaml`), health & maintenance (compare `fro-bot/agent`, `actions/checkout`, `dorny/paths-filter`, `frenck/action-addon-linter`, `creyD/prettier_action`, `chrisdickinson/setup-yq` against current SHAs; bump `bfra-me/.github` reusable workflow when newer), developer experience (Prettier, shellcheck on `example/rootfs/**/{run,finish}`, config.yaml/build.yaml required fields, version-vs-CHANGELOG consistency, `.tool-versions` drift).
- **Single perpetual issue:** Maintains a single open issue titled exactly `Daily Autohealing Report` and prepends dated update sections — this is **not** the same pattern as ha-config or sibling repos that create new issues per cycle.
- Uses `secrets.FRO_BOT_PAT` for checkout and agent token; `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG` secrets; `vars.FRO_BOT_MODEL` for model selection.

### `renovate.yaml` — Renovate orchestration
- Uses `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.16` (SHA `71213b76`).
- Triggers: `issues.edited`, `pull_request.edited`, `push` (non-main), `workflow_dispatch` (log-level + print-config inputs), `workflow_run` (after `Main` succeeds on `main`).
- Conditional log level: debug on PRs / non-default branches, info otherwise.

### `update-repo-settings.yaml` — Probot Settings sync
- Uses `bfra-me/.github/.github/workflows/update-repo-settings.yaml@v4.16.16`.
- Triggers: `push` to `main`, daily at 14:15 UTC, `workflow_dispatch`.

## Configuration

### Renovate (`renovate.json5`)
- Extends `github>bfra-me/renovate-config#5.2.1` plus `:enablePreCommit`. This is a **different** preset family than the `marcusrbrown/renovate-config` line used across the rest of the ecosystem (`marcusrbrown/renovate-config#4.5.x`).
- Package rules:
  - HA base images (`ghcr.io/home-assistant/**`, `home-assistant/**`) grouped as "Home Assistant Add-ons" with `pinDigests: false`.
  - `ghcr.io/hassio-addons/**` grouped as "hassio-addons".
  - `home-assistant/actions/*` regex match grouped.
  - `home-assistant/builder` action: custom version extraction (`^\d+\.\d+\.\d+$`), single-bump strategy (no separate major/minor/patch).
  - `python` dep capped at `<=3.13`.
- Custom managers cover three patterns: `build.yaml` arch keys + `# renovate:` comments, `Dockerfile` `ARG BUILD_FROM=...@sha256:...` and `# renovate:` comments, and Alpine package versions via `repology` datasource (`alpine_3_20/{pkg}`).

### Probot Settings (`.github/settings.yml`)
- Extends `.github:common-settings.yaml` (org-level common settings — note the bare `.github:` prefix, which resolves to `bfra-me/.github`, not Marcus's personal `.github`).
- Repo: `is_template: true`, topics, description.
- Branch protection on `main`:
  - Required status checks (strict): `Prepare`, `Lint`, `Build`, `Renovate / Renovate`, `Fro Bot`
  - `enforce_admins: true`
  - 1 required approving review, dismiss stale reviews on push
  - `required_linear_history: true`
  - No code-owner-review requirement, no restrictions

### Tooling
- **`.tool-versions`:** Node 22.11.0, Python 3.13.13.
- **`.devcontainer.json`** present (contents not surveyed under read-limit policy).
- **`.pre-commit-config.yaml`** present, integrated via Renovate `:enablePreCommit`.
- **`.markdownlint-cli2.yaml`**, **`.prettierrc.yaml`** present.
- **`.cursorrules`** present (Cursor IDE context).

## Cross-Ecosystem Notes

| Aspect | bfra-me/ha-addon-repository | [[marcusrbrown--ha-config]] |
|---|---|---|
| Purpose | Template for building & publishing HA add-ons | Running HA config (consumes add-ons & components) |
| Renovate base | `bfra-me/renovate-config#5.2.1` | `marcusrbrown/renovate-config#4.5.x` |
| Probot extends | `.github:common-settings.yaml` (bfra-me org) | `fro-bot/.github:common-settings.yaml` |
| Fro Bot agent | v0.43.1, present, daily autoheal at 15:30 UTC | **Not present** (carried-forward recommendation) |
| Fro Bot issue model | Single perpetual `Daily Autohealing Report` | n/a |
| Build target | Multi-arch Docker images → GHCR with cosign | n/a (no add-on builds) |
| HA validation tool | `frenck/action-addon-linter` | `frenck/action-home-assistant` |

The two `frenck/action-*` tools are siblings serving the two sides of the HA development workflow: linter for the add-on contract, home-assistant for the running config. See [[home-assistant]] for the latter.

## Observations

- **Template hygiene:** README's HTML comment block is the de-facto onboarding checklist for forkers (rename `example/`, update `image:` to your username, adjust `repository.yaml`, update `version` and `CHANGELOG.md` per release). It is not enforced by CI — a fork that forgets to update `image:` will silently publish under `bfra-me`'s namespace. Worth promoting to a `scripts/init-fork.sh` or pre-commit hook in any downstream usage.
- **HA base-image arch split:** `aarch64`/`amd64` on Alpine 3.23, `armhf`/`armv7` on 3.22. The base-image producers (`ghcr.io/home-assistant/*-base`) lag on 32-bit ARM. The Renovate `Home Assistant Add-ons` group keeps them coordinated, but expect drift to persist as upstream prioritizes 64-bit.
- **`pinDigests: false` for HA base images** is intentional — combined with the explicit `@sha256:...` in the Dockerfile, the digest is rotated by the custom Dockerfile manager (`ARG BUILD_FROM=...@sha256:...` matchString), not by `build.yaml`. This keeps the build reproducible while letting `build.yaml` stay readable as tag-only.
- **`enforce_admins: true`** on the template means downstream forks inherit a strict policy that the original maintainer must also follow — a footgun for solo forks until they relax it.
- **No CodeQL, no Scorecard, no Trivy** — security scanning is delegated to Renovate alerts and the Fro Bot autoheal sweep. Reasonable for a template; downstream add-on collections handling real services should add at least a Hadolint/Trivy gate.
- **Five open issues** (per gh metadata at survey time), zero open PRs.

## Survey History

| Date | SHA | Notes |
|---|---|---|
| 2026-05-20 | `0a163c3f` | Initial survey. Fro Bot agent v0.43.1, four workflows, example add-on at v1.2.2, HA base images Alpine 3.22/3.23, Node 22.11.0, Python 3.13.13. |
