---
type: repo
title: marcusrbrown/gpt
node_id: R_kgDOK0Z5CA
created: 2026-04-18
updated: 2026-09-03
sources:
  - url: https://github.com/marcusrbrown/gpt
    sha: 556bc738e9c5af627c98621418f6b46cdbb3984c
    accessed: 2026-09-03
  - url: https://github.com/marcusrbrown/gpt
    sha: f6117f0b1b79e37c2ab5476beead2056649724f5
    accessed: 2026-08-08
  - url: https://github.com/marcusrbrown/gpt
    sha: a6f661f182d42379bc650e5e5be75d9e7c4c9fcc
    accessed: 2026-07-14
  - url: https://github.com/marcusrbrown/gpt
    sha: 174e5179026331ef6cc72549c2519af5acae3dc0
    accessed: 2026-06-30
  - url: https://github.com/marcusrbrown/gpt
    sha: 182e23d701acef6615ae3194343c2bda2e0cfa5b
    accessed: 2026-06-19
  - url: https://github.com/marcusrbrown/gpt
    sha: 36b50c9254c1795edd75331a4b0dad07961a49e1
    accessed: 2026-06-08
  - url: https://github.com/marcusrbrown/gpt
    sha: aac010356a3e0d7fd21a5883b98d0cdf6229ed60
    accessed: 2026-05-27
  - url: https://github.com/marcusrbrown/gpt
    sha: 0bb8eedf6e23bfb5715d127763fd864ab7da72cd
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/gpt
    sha: 60bd62e86caa1a07610c2162d9ffbb917d172dc3
    accessed: 2026-04-18
tags:
  - gpt
  - react
  - typescript
  - vite
  - langchain
  - mcp
  - local-first
  - heroui
  - tailwindcss
  - indexeddb
  - web-crypto
  - pdfjs
  - mammoth
  - pnpm
  - fro-bot
  - autoheal
  - working-dir-delivery
  - required-checks
aliases:
  - gpt
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--copiloting
  - marcusrbrown--marcusrbrown-com
  - fro-bot--agent
  - bfra-me--ha-addon-repository
---

# marcusrbrown/gpt

Local-first, privacy-focused GPT creation and management platform. Mirrors core OpenAI GPT Builder functionality while keeping all data client-side. Deployed to GitHub Pages at [gpt.mrbro.dev](https://gpt.mrbro.dev).

## Overview

- **Purpose:** Create, customize, and interact with AI assistants locally
- **Default branch:** `main`
- **Created:** 2023-12-01
- **Repo id / node_id:** `726038792` / `R_kgDOK0Z5CA`
- **Last push:** 2026-09-03 (HEAD commit `556bc73`, `chore(deps): update fro-bot/agent to v0.107.1 (#2747)`)
- **Homepage:** https://gpt.mrbro.dev (GitHub Pages)
- **License:** MIT
- **Topics:** `chatgpt`, `gpt`, `gpt-4`, `nlp`, `transformers`
- **Size / tree:** ~12.9 MB, **342 blobs / 66 trees** (2026-09-03)
- **Node.js:** 24.18.0 (`.tool-versions`) — unchanged since 2026-06-30
- **Package manager:** pnpm 11.11.0 (was 11.9.0) — major cutover from 10.34.4 landed 2026-07 (PR #2620); `pnpm-workspace.yaml` carries `overrides`, `allowBuilds`, `minimumReleaseAgeExclude`, and pnpm settings previously inlined in `package.json`
- **Counts (2026-09-03):** 1 star, 1 watcher, 0 forks, `open_issues_count` 38 = **23 issues + 15 PRs** (see the measurement correction below)

## 2026-09-03 survey — the daemon is green, the work is not landing

This is the first survey of this repo where the interesting artifact is not the tree. The tree barely moved; the automation around it broke in a way that produces a perfectly healthy-looking signal.

### The tree is effectively frozen — quantified

Recursive blob diff `f6117f0` (2026-08-08) → `556bc73` (2026-09-03): **342 blobs before, 342 after, 0 added, 0 removed, 4 changed.** The four are `.github/workflows/fro-bot.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — all dependency/pin plumbing. **Zero changes under `src/`, `tests/`, `docs/`, `RFCs/`, `scripts/`, `.github/agents/` in 26 days.** No human commit is visible in the window.

`fro-bot.yaml`'s diff across those 26 days is exactly one line: the agent pin. Its last 20 commits are *all* `chore(deps): update fro-bot/agent to vX` (v0.96.3 on 2026-08-07 → **v0.107.1** on 2026-09-03, 12 minors in 27 days). The workflow body has not been edited once while the harness underneath it advanced 12 minors.

### The headline: `working-dir` delivery with no caller-side commit step

Since **2026-08-20** every autoheal run summary in the perpetual issue #2431 declares delivery mode `working-dir` — the contract where the agent writes files into the checked-out tree and *the caller workflow* owns diff detection, commit, push, and PR creation.

`fro-bot.yaml` has no such caller-side step. The job is four steps — Sunday detection, fork refusal, checkout, `setup-pnpm`, review-input validation, `Run Fro Bot` — and the file **ends** at `timeout: 0`. Nothing after the agent action inspects, commits, or pushes anything. Every file the agent writes is discarded when the runner is torn down.

The consequences are all verifiable from the tree:

- The 2026-09-02 and 2026-09-03 reports both claim `pnpm-workspace.yaml` overrides were added for `browserslist`, `ip-address`, `ws`, and `brace-expansion`. The live file at HEAD carries **three** overrides — `fast-uri`, `langsmith`, `path-to-regexp` — the same three as on 2026-08-08. None of the claimed remediations exist.
- The reports claim `RFCs/AGENTS.md` and `.ai/AGENTS.md` were created. Neither path is in the tree.
- The reports claim drift repairs to `docs/AGENTS.md`, `notebooks/AGENTS.md`, `scripts/AGENTS.md`, `src/components/mcp/AGENTS.md`, `.gitignore`. All five blobs are byte-identical to 2026-08-08.

**The bot diagnosed itself before this survey did.** The 2026-09-03 comment on #2431 states that the identical working-tree fix set has been "independently recomputed 6 consecutive days (2026-08-28 → 2026-09-03) without landing on `main`", notes that the workflow "has no visible diff-detection/commit/push/PR-creation step", and recommends an operator verify whether the harness handles `working-dir` delivery internally. It is right. It has been right, in a rolling issue nobody reads, for six days — and the underlying break has been live for fifteen.

Note what still works: **issue writes land, file writes do not.** The one channel the harness will deliver on is prose about the work it did not deliver. That is precisely why 13 of 13 recent scheduled runs conclude `success`: the run genuinely did everything it was asked except persist.

### Why nobody caught it: Renovate updates the pin, not the integration

The agent pin is Renovate-owned and same-day-automerged. Between 2026-08-19 (v0.101.0) and 2026-08-21 (v0.102.0) the delivery contract changed under the workflow; `working-dir` first appears in the report stream on **2026-08-20**, one day after the v0.101.0 merge. No PR in that window touched the workflow body, because no dependency bot can.

Durable form: **SHA-pinning plus automerge yields a continuously-updated action and a permanently-stale integration.** A version bump is presented as a dependency change; when the action is a *harness*, it is an interface change, and the diff that would be required on the consumer side is invisible to the tool doing the bumping. This is the temporal sibling of the mis-pathed `uses:` defect at [[marcusrbrown--esphome-life]] (SHA pinning validates the ref, not the path) and of the `>=` floor rule in [[github-actions-ci]] (a pin proves a past state, not a current one).

### Two separate stalls, not one

The delivery break explains the file-write drought but **not** the PR drought. The newest open PR is **#2693, created 2026-07-29** — 36 days before this survey, and three weeks before `working-dir` appears. `fro-bot` has opened zero PRs since. The cause of the earlier stall is not determinable from the reads permitted here; recorded as an open question rather than folded into the delivery story.

### The open-PR queue: 15 open, none younger than 36 days

| PR | Author | Created | Last touched | Subject |
| --- | --- | --- | --- | --- |
| #2165 | fro-bot | 2026-03-28 | 2026-05-10 | HeroUI v2 → v3 migration (**6th consecutive survey open**) |
| #2320 | mrbro-bot | 2026-04-19 | 2026-07-19 | react monorepo |
| #2440 | mrbro-bot | 2026-05-14 | 2026-07-19 | `@bfra.me/eslint-config` v0.51.1 |
| #2586 / #2587 | fro-bot | 2026-06-19 | 2026-07-21 | hono / undici security pins (**4th survey**) |
| #2599 | fro-bot | 2026-06-21 | 2026-06-22 | remove unsafe spy casts |
| #2662 | mrbro-bot | 2026-07-07 | 2026-07-19 | all non-major deps |
| #2664, #2665, #2672, #2673, #2674, #2692 | fro-bot | 2026-07-08 → 07-28 | = creation date | **Ollama contrast cluster, six PRs, one root cause** |
| #2688 | fro-bot | 2026-07-27 | 2026-07-27 | skip-link focus target |
| #2693 | fro-bot | 2026-07-29 | 2026-07-29 | stabilize archive restore flow |

**Correction to the 2026-08-08 reading.** That survey called the contrast cluster "monotonically accreting — the contrast daemon the autoheal loop keeps re-summoning." It stopped accreting: the cluster has been frozen at six since 2026-07-28, and every one of the six has `updated_at` equal to its creation timestamp — opened, never rebased, never reviewed, never touched again. The prediction of continued growth is superseded. The daemon did not get exorcised; it got muted along with everything else.

Meanwhile HEAD is a Renovate merge from this morning. **Renovate PRs open and merge same-day and are therefore invisible in an open-state snapshot; `fro-bot` PRs open and stay.** Same authorship-sorted merge reality recorded at [[marcusrbrown--marcusrbrown-com]] on 2026-09-01 — with the added wrinkle that here the branch protection is not the discriminator (`enforce_admins: true`, no required reviews, 13 required contexts, identical for both authors). Automerge eligibility is.

### DEDUPLICATION clause failure, third ecosystem instance

`AUTOHEAL_PROMPT` opens with an explicit rule: "Before creating any new PR or issue, search for an existing open bot-authored PR/issue for the same root cause. Reuse or update the existing item instead of creating a duplicate." It failed six times on the same Ollama contrast defect over 20 days, and again in the issue tracker — **#2171 "Migrate Card/Link/Avatar/Tooltip components to v3" and #2173 "Migrate Card/Link/Avatar/Tooltip to v3"** were both opened by `fro-bot` on 2026-03-28.

Joins [[marcusrbrown--marcusrbrown-com]] #473/#523 (byte-identical proposals 32 days apart) and [[marcusrbrown--mrbro-dev]] #283/#254. Third confirmation, and the strongest: six near-identical PRs is not a near-miss on a search heuristic, it is a rule that does not execute.

### Create-authority without close-authority produces monotonic backlog

The prompt's hard boundaries include: "Never merge PRs, submit reviews/approvals, close/reopen PRs or issues ... EXCEPT for closing duplicate 'Daily Autohealing Report' issues." The agent may open issues and PRs indefinitely and may retire exactly one class of its own output.

The 23 open issues are what that produces. Eight of them (#2162, #2168–#2175) are a HeroUI-v3 migration fossil bed opened on a single day, 2026-03-28, untouched since. Six more (#2140–#2146) are a single 2026-03-25 tech-debt sweep. **#2142 "techdebt: E2E Tests Disabled in CI Pipeline" is arguably already resolved** — `test-e2e.yaml` is indeed `.disabled`, but `test-coverage.yaml` runs `pnpm run test:e2e` on every qualifying PR and push, so the E2E suite is not disabled, it moved. The daemon has re-audited this repo daily for months and cannot close it.

Durable form: **an agent granted create-authority but denied close-authority produces a monotonically growing backlog whose age distribution is a measurement artifact rather than a signal.** The 90-day-stale-issue metric on this repo measures the prompt's boundary section, not the project.

### Required status checks that pass by not running

Branch protection requires 13 contexts. Three of them can be satisfied without executing their nominal work:

1. **`Deploy`** — `main.yaml`'s deploy job is `if: github.ref == 'refs/heads/main'`. On every pull request it is skipped, and GitHub scores a skipped required check as passing. A required gate that structurally cannot run on the thing it gates.
2. **`E2E Test Coverage` / `E2E Test Report`** — `test-coverage.yaml`'s `e2e-coverage` job is gated on a `dorny/paths-filter` result; when the filter misses, the job skips, `report` skips with it (`needs.e2e-coverage.result != 'skipped'`), and both required contexts go green having run nothing.
3. **`Run Tests` and `Build`** — the jobs always run, but their real steps are `if: steps.cache-*.outputs.cache-hit != 'true'`. On a cache hit the job reports success without invoking `pnpm test:coverage` or `pnpm build`. The keys are content-hashed and mostly sound (`src/**/*.{ts,tsx}`, `tests/**`, lockfile, `tsconfig*`), but the build key omits `vite.config.ts`, `src/index.css`, `eslint.config.ts`, and `.tool-versions` — so a PR changing only the Vite config, the Tailwind entrypoint, or the Node version takes a cache hit and produces a green required `Build` that compiled nothing.

Same family as [[bfra-me--ha-addon-repository]]'s required `Fro Bot` check, which is only evaluated on `pull_request` events where the bot guard makes it skip-and-pass — 17 days of red scheduled runs never touching mergeability. Here the effect is milder and the mechanism is the same: **a required check name is a claim about coverage; only the job's execution conditions decide whether it is true.**

Also worth naming: `Prepare` is a required context and is a job name in **five** different workflows. Required checks match by context name, so `Prepare` is satisfied by whichever workflow reports first.

### Rolling reports with no machine-stable envelope

Twelve consecutive daily comments on #2431 carry seven distinct heading formats:

```
## Run Summary
<!-- BOT: fro-bot -->
## 🤖 Fro Bot Autohealing Run Summary — 2026-08-26
🤖 **Fro Bot — Daily Autohealing Run Summary**
## Daily Autohealing Run Summary — 2026-08-29 (UTC)
### Run Summary
## Fro Bot — Autoheal Run Summary (2026-09-03)
```

Some carry an HTML-comment marker (`<!-- fro-bot:autoheal-summary -->`, `<!-- fro-bot-run-summary -->`, `<!-- fro-bot:daily-auto… -->`) — and those markers are not stable across days either. The prompt specifies a rich section/table schema for the *issue body* but says nothing about the envelope of the *comment*. Result: 59 accumulated reports that no downstream tool can dedupe, diff, or trend. The delivery break above sat plainly in that stream for six days and was legible only to a human reading prose.

Durable form: **an LLM-authored rolling report needs a fixed machine-stable envelope — one invariant HTML-comment marker and one invariant heading — or the accumulated stream is prose-only and un-queryable.** Specify the envelope, not just the sections.

### Prompt drift and cross-mode leakage

Both `PR_REVIEW_PROMPT` and `AUTOHEAL_PROMPT` open by describing the stack as "React 19, TypeScript 5.9, **Vite 7**, HeroUI, TailwindCSS 4". The repo has been on Vite 8 since before the initial 2026-04-18 survey and is on **8.2.2** today. Every review and every autoheal run for months has been briefed on a stack line that is wrong about the build tool. Same class as the `AGENTS.md` stack-line drift at [[marcusrbrown--marcusrbrown-com]] (2026-09-01) — and here the drift is inside the file the autoheal prompt is forbidden to edit ("Do not modify .github/workflows/ … or automation prompt files").

Separately, `PR_REVIEW_PROMPT` carries two directives that belong to the scheduled modes and are meaningless during a pull-request review: "Upstream modernization watch (category 7) MUST NOT bump pinned versions" and "Do not create multiple summary issues." Copy-paste bleed between the three prompt envs in a single-file three-mode workflow — cheap to introduce, invisible in review, and it spends reviewer-model attention on constraints that cannot apply.

### The prompt authorizes what the harness forbids

`AUTOHEAL_PROMPT` states: "This workflow may only push fixes, open/update PRs, open/update issues, and comment on PRs when a fix was pushed." The job carries `contents: write`, `issues: write`, `pull-requests: write` to back that. The harness at v0.107.1 resolves `working-dir` delivery, which forbids branch creation, commits, pushes, and `gh pr create` outright.

**The prompt grants authority the harness declines to use, and the harness wins silently.** No error, no warning, no failed check — the agent reads a delivery contract that overrides the prompt, complies with it, reports accurately, and the run is green. The failure is entirely in the gap between two correct documents.

### Measurement correction carried forward

Prior surveys recorded "open issues 25 → 22 → 23 → 36 → 38". Those are `open_issues_count`, which GitHub defines as **issues plus pull requests**. Today's 38 decomposes as 23 issues + 15 PRs. The 2026-07-14 jump from 23 to 36 is therefore substantially the arrival of the Ollama PR cluster, not an issue-filing surge. Earlier rows in the survey history are left as written and annotated here rather than rewritten, per the additive-update rule.

### Two under-recorded controls, present since before 2026-08-08

Neither is new; both were missed by prior surveys and are worth having on the record.

- **Fork-head refusal on comment triggers.** A dedicated step runs on `issue_comment` events against PRs, calls `repos/{repo}/pulls/{n}` for `.head.repo.fork`, and hard-fails unless it is exactly `false` — before the checkout step that would fetch `refs/pull/N/head` with `FRO_BOT_PAT` in the environment. This is the correct shape: verify provenance *before* materializing untrusted code, and fail closed on `"unknown"`. Complements the job-level `if:` guard rather than duplicating it.
- **Review-mode input validation.** `workflow_dispatch` with `mode=review` and an empty `prompt` fails fast with an `::error::` rather than dispatching an empty prompt. Same guard [[bfra-me--renovate-action]] adopted; present here at least since 2026-08-08.

## Tech Stack

Versions below are as of the 2026-09-03 survey (HEAD `556bc73`).

| Layer | Technology | Notes |
| --- | --- | --- |
| Framework | React 19.2.5, TypeScript 5.9.3 | Strict mode, `@/` import alias |
| Build | Vite **8.2.2**, `@vitejs/plugin-react-swc` 4.3.3 | `tsgo` (`@typescript/native-preview` 7.0.0-dev.20260703.1 — **held since 2026-07-03**) for type-checking; `vite-tsconfig-paths` 6.1.1 |
| Styling | TailwindCSS 4.3.3, HeroUI 2.8.10, `next-themes` 0.4.6 | Semantic design tokens only; `@tailwindcss/typography` 0.5.20 for prose. HeroUI has been pinned at 2.8.10 since the initial survey — see PR #2165 |
| Storage | IndexedDB via Dexie 4.4.4 | Local-first; no localStorage for structured data; `lru-cache` 11.5.1 for in-memory caching |
| Security | Web Crypto API (AES-GCM, PBKDF2) | Client-side encryption for API keys |
| AI | LangChain **1.5.10**, `@langchain/core` **1.2.9**, `@langchain/openai` **1.5.10**, `@langchain/anthropic` **1.5.8**, `@langchain/langgraph` 1.4.7 | Provider-abstracted via `BaseLLMProvider`; `openai` 6.45.0. LangChain packages are Renovate-grouped and minor/patch-automerged, which is why this line moves fastest |
| MCP | `@modelcontextprotocol/sdk` 1.29.0 | Tool integration via Model Context Protocol; unchanged since the initial survey |
| Editor | Monaco Editor (`@monaco-editor/react` 4.7.0) | In-app code/prompt editing |
| Routing | React Router DOM **7.18.3** | Route-level lazy loading; `react-swipeable` 7.0.2 for gesture nav |
| Validation | Zod 4.4.3 | Zod-first: define schema, infer type |
| Documents | `pdfjs-dist` 6.2.108, `mammoth` 1.12.0, `jszip` 3.10.1, `file-saver` 2.0.5 | Client-side PDF/DOCX ingestion + zip/file export for knowledge base and backup/restore; `pdfjs-dist` crossed **v5 → v6 major** on 2026-08-08 |
| Testing | Vitest **4.1.11**, `@vitest/eslint-plugin` 1.6.20, Playwright 1.62.1, axe-core (`@axe-core/playwright` 4.12.1), Lighthouse 13.4.0, `fake-indexeddb` 6.2.5, jsdom **29.1.1** | Unit, E2E, accessibility, visual, performance. Autoheal reports 450/450 unit, 146 passed / 6 skipped E2E, 97/97 accessibility |
| Linting | ESLint **10.9.1**, `@bfra.me/eslint-config` 0.50.1, Prettier 3.9.6, `eslint-plugin-react-hooks` **7.0.1** | `@bfra.me/prettier-config/120-proof` (120-char lines) at **0.16.11**; `@bfra.me/tsconfig` **0.13.2** |

### `minimumReleaseAgeExclude` (observed 2026-09-03)

`pnpm-workspace.yaml` carries a new-since-2026-08-08 block:

```yaml
minimumReleaseAgeExclude:
  - '@bfra.me/prettier-config@0.16.10 || 0.16.11'
  - '@bfra.me/tsconfig@0.13.2'
```

No `minimumReleaseAge` key appears in the workspace file, and the repo has no `.npmrc` — so the cooldown being punctured comes from pnpm's own defaults rather than an in-repo setting. Two properties worth flagging:

- The exclusions are **exact-version pins**, so each one dies the moment the excluded package publishes again. `0.16.10 || 0.16.11` is already an accreted disjunction — the shape a hole punched twice takes.
- Nothing in CI notices a stale exclusion. It is not a lint target, not a Renovate target, and its failure mode is silent (the cooldown simply reapplies). Expect this list to grow monotonically and to be mostly dead entries within a few months.

## Architecture

The project follows a modular, provider-abstracted architecture with four layers:

1. **Data Layer:** IndexedDB (Dexie.js) for structured data, Web Crypto for security, LRU cache for performance
2. **Service Layer:** Decoupled services for storage, encryption, provider management, MCP, conversations, export/import
3. **Provider Layer:** Pluggable LLM backends via `BaseLLMProvider` — OpenAI, Anthropic, Azure, Ollama
4. **UI Layer:** Component-driven with HeroUI and TailwindCSS 4 semantic tokens

### Key Directories

| Directory | Purpose |
| --- | --- |
| `src/components/` | React components (HeroUI-based, chat UI, forms, settings, MCP, editor tabs) |
| `src/services/` | Business logic — storage, encryption, providers, MCP client, export/import, versioning |
| `src/services/providers/` | LLM provider implementations (OpenAI, Anthropic, Azure, Ollama, registry) |
| `src/lib/` | Utilities — `design-system.ts`, `crypto.ts`, `database.ts` |
| `src/pages/` | Route-level components — home, GPT editor, showcase, settings, backup/restore, test, OAuth callback |
| `src/hooks/` | Custom React hooks (state access) |
| `src/types/` | Zod schemas and inferred TypeScript types |
| `src/contexts/` | React Context providers |
| `src/config/` | App configuration (site metadata) |
| `tests/` | E2E (31 files), accessibility (16), visual (22), performance (6) — 75 test files plus `tests/AGENTS.md` |
| `scripts/` | **(added to this table 2026-09-03; present earlier, previously unrecorded)** Test-result aggregation and reporting — `aggregate-test-results.ts`, `report-test-results.ts`, and `scripts/lib/` with parallel `parsers/` and `formatters/` modules per test tier (accessibility, coverage, e2e, performance, visual) plus `github-comments.ts` and `job-summary.ts`. This is the mechanism behind the "Generate … Report" CI jobs |
| `notebooks/` | Deno Jupyter notebooks — `agents/analysis/code-analyzer.ipynb`, `templates/agent.ipynb`, `AGENTS.md` |
| `docs/` | Project docs — overview, PRD, features, design system, `RULES.md`, agent development, `AGENTS.md` |
| `RFCs/` | 13 architectural decision records (RFC-001 through RFC-013) |
| `.ai/` | Planning/analysis corpus — `plan/` (7 docs), `docs/` (3), `notes/` (1); see below |

**Correction (2026-09-03) — the notebooks were restructured at some point before 2026-08-08.** Surveys from 2026-04-18 onward recorded three notebooks in `notebooks/agents/`: `01-repo-ranger.ipynb`, `01-gpt-architect.ipynb`, `01-baroque-bitch.ipynb`. None of those paths exist at HEAD `556bc73`, and none existed at `f6117f0` either — the tree diff between the two is 4 files, so the change predates the 2026-08-08 survey and was carried forward unverified. The current layout is two files: `notebooks/agents/analysis/code-analyzer.ipynb` and `notebooks/templates/agent.ipynb`. The prior listing is left above in the Notebooks section with a dated annotation rather than deleted. Cause is a general one worth naming: a section written once from a directory listing and never re-derived will outlive the thing it describes, and nothing in the ingest pipeline flags it, because a stale claim reads exactly like a durable one.

### `.ai/` planning corpus

Eleven markdown files, none of them configuration despite this page's earlier "AI-specific configuration" description:

- `.ai/plan/` — `feature-comprehensive-testing-framework-1.md`, `feature-langgraph-agent-1.md`, `refactor-animations-interactions-1.md`, `refactor-card-components-1.md`, `refactor-form-components-1.md`, `refactor-navbar-component-1.md`, `refactor-typography-system-1.md`
- `.ai/docs/` — `animation-mapping-document.md`, `current-implementation-audit.md`, `micro-interaction-patterns.md`
- `.ai/notes/` — `kewl-prompts.md`

The same `.ai/plan/` aspirational-plan-corpus pattern recorded at [[bfra-me--github]] (2026-07-16) and [[marcusrbrown--marcusrbrown]] (2026-08-19). Five of the seven plans are UI refactors (cards, forms, navbar, typography, animations) against a `src/components/` tree that has not changed in 26 days — a plan corpus and a HeroUI-v3 issue fossil bed describing the same unstarted work from two directions.

### LLM Providers

Four provider implementations in `src/services/providers/`:

- `openai-provider.ts` — OpenAI API (GPT-4, etc.)
- `anthropic-provider.ts` — Anthropic API (Claude)
- `azure-provider.ts` — Azure OpenAI Service
- `ollama-provider.ts` — Local Ollama models
- `base-provider.ts` — Abstract base class (`BaseLLMProvider`)
- `provider-registry.ts` — Provider registration and discovery

UI code never imports LLM SDKs directly; all access goes through the provider abstraction.

### RFCs

13 RFCs tracking architectural decisions:

| RFC     | Topic                          |
| ------- | ------------------------------ |
| RFC-001 | IndexedDB Storage Foundation   |
| RFC-002 | Security Infrastructure        |
| RFC-003 | Provider Abstraction Layer     |
| RFC-004 | GPT Configuration Management   |
| RFC-005 | Conversation Management        |
| RFC-006 | Knowledge Base Enhancement     |
| RFC-007 | Export/Import System           |
| RFC-008 | Anthropic Provider Integration |
| RFC-009 | MCP Tool Integration           |
| RFC-010 | Ollama Local Models            |
| RFC-011 | Advanced Tools Sandbox         |
| RFC-012 | Tauri Desktop Application      |
| RFC-013 | UI/UX Improvements             |

### Notebooks

**Current (2026-09-03):** `notebooks/agents/analysis/code-analyzer.ipynb`, `notebooks/templates/agent.ipynb`, `notebooks/AGENTS.md`.

**Superseded (recorded 2026-04-18 through 2026-08-08, no longer present):** three notebooks in `notebooks/agents/` — `01-repo-ranger.ipynb` (code analysis and security checking), `01-gpt-architect.ipynb` (assistant development and optimization), `01-baroque-bitch.ipynb` (art generation and style transfer). Retained here as the historical record; see the correction note under Key Directories.

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Lint + test + build + deploy |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, schedule (03:30 + 15:30 UTC), dispatch | Three-mode single-file workflow: review / maintenance / autoheal |
| Renovate | `renovate.yaml` | issues, PR, push, dispatch, `workflow_run` | Dependency updates (via `bfra-me/.github` reusable workflow); job `Renovate` |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, cron `23 */12 * * *`, dispatch | Probot settings sync (18 lines) |
| Test Coverage | `test-coverage.yaml` | push, PR, dispatch | **Runs the E2E suite** (`pnpm run test:e2e`) behind a `dorny/paths-filter` gate; jobs `Prepare`, `E2E Test Coverage`, `E2E Test Report` |
| Test Accessibility | `test-accessibility.yaml` | push, PR, dispatch | WCAG 2.1 AA audit; jobs `Run Accessibility Tests`, `Generate Accessibility Report` |
| Visual Tests | `visual-tests.yaml` | push, PR, dispatch | Screenshot regression; jobs `Run Visual Tests`, `Update Visual Baselines` |
| Test Performance | `test-performance.yaml` | push, PR, dispatch, cron `0 0 * * 0` | Lighthouse audits; jobs `Run Performance Tests`, `Generate Performance Report` |
| Cache Cleanup | `cache-cleanup.yaml` | PR, cron `0 0 * * 0`, dispatch | Actions cache maintenance |
| Copilot Setup | `copilot-setup-steps.yaml` | dispatch, push, PR | GitHub Copilot coding agent bootstrap |
| E2E Tests | `test-e2e.yaml.disabled` | — | **Fossil.** Disabled by filename suffix. Its jobs (`Run E2E Tests`, `Run E2E Tests (Mobile)`, `Generate Test Report`) are not required contexts, and the E2E suite itself now runs from `test-coverage.yaml` — so issue #2142 ("techdebt: E2E Tests Disabled in CI Pipeline", open since 2026-03-25) is largely stale

**Note:** The prior `fro-bot-autoheal.yaml` has been folded into `fro-bot.yaml` as an `autoheal` mode (PR review → `pull_request`, maintenance/autoheal → cron). This matches the consolidated three-mode pattern adopted across the ecosystem.

**Setup composite action (2026-06-30):** A new `.github/actions/setup-pnpm/action.yaml` composite action centralizes the pnpm + Node bootstrap (and optional Playwright browser install/caching) across all workflows. It is adapted from `bfra-me/works`'s `pnpm-install` action and pins `pnpm/action-setup@v5.0.0`, `actions/setup-node@v6.4.0`, and `actions/cache@v5.1.0`, reading the Node version from `.tool-versions`. Workflows (`fro-bot.yaml`, `main.yaml`, `renovate.yaml`, `update-repo-settings.yaml`) now call `uses: ./.github/actions/setup-pnpm` instead of inlining setup steps — a DRY consolidation, not a behavior change.

### Main CI Jobs

The main workflow runs four jobs after a `Prepare` step:

1. **Lint** — `pnpm lint` (ESLint)
2. **Run Tests** — `pnpm test:coverage` with Codecov upload
3. **Build** — `pnpm build` (tsgo + Vite production build)
4. **Deploy** — GitHub Pages deployment (main branch only)

### Branch Protection

Required status checks on `main` (13, from `.github/settings.yml`, `strict: false`): Build, Deploy, E2E Test Coverage, E2E Test Report, Generate Accessibility Report, Generate Performance Report, Lint, Prepare, `Renovate / Renovate`, Run Accessibility Tests, Run Performance Tests, Run Tests, Run Visual Tests. Linear history enforced, `enforce_admins: true`, `required_pull_request_reviews: null`, no restrictions.

**Note (2026-09-03):** three of these can pass without running their nominal work (`Deploy` skips on every PR; `E2E Test Coverage`/`E2E Test Report` skip on a paths-filter miss; `Run Tests`/`Build` no-op on a cache hit). See "Required status checks that pass by not running" above. `Prepare` is a job name in five workflows and is satisfied by whichever reports.

### Content Security Policy

Vite build injects a CSP `<meta>` tag restricting:

- `connect-src` to `self`, `api.openai.com`, `api.anthropic.com`, `localhost:11434` (Ollama)
- `script-src` to `self`
- `object-src` and `form-action` locked down

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.4` (bumped from `#5.2.3`) — crossed the v4 → v5 boundary on 2026-05-13 (PR #2435). Groups LangChain.js monorepo packages. Automerges unstable minor updates of `lucide-react` (monthly) and select LangChain/TailwindCSS packages via `bfra-me/renovate-config:automerge.json5#5.2.3`. Post-upgrade runs bootstrap, fix, and build. Package overrides — pinning `fast-uri>=3.1.2`, `langsmith>=0.6.0`, `path-to-regexp>=8.4.0` — now live under `overrides:` in `pnpm-workspace.yaml` (moved out of `package.json`'s `pnpm.overrides` as part of the pnpm v11 cutover).
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **Git Hooks:** `simple-git-hooks` with `lint-staged` running ESLint with auto-fix on staged files.
- **AGENTS.md hierarchy:** Root AGENTS.md plus directory-level guides in `src/`, `tests/`, `scripts/`, `notebooks/`, `docs/`, `.github/`, `RFCs/`, `.ai/`. Comprehensive conventions for AI-assisted development.
- **Named agent definitions (2026-08-08):** `.github/agents/{reviewer,test-writer}.agent.md` — frontmatter-tagged, harness-selectable agent personas scoped to review and test-authoring; see Fro Bot Integration below.
- **CODEOWNERS (2026-08-08):** New root-level `.github/CODEOWNERS` observed.
- **Copilot:** `copilot-instructions.md` and `copilot-setup-steps.yaml` for GitHub Copilot coding agent.
- **Codecov:** Coverage tracking via `codecov.yml`.
- **Configs:** Extends `@bfra.me/tsconfig`, `@bfra.me/eslint-config`, `@bfra.me/prettier-config` shared configurations.

## Fro Bot Integration

**Full Fro Bot integration detected.** Single consolidated workflow — `fro-bot.yaml` — handling three modes via a `workflow_dispatch` `mode` input plus dual cron schedules (03:30 UTC autoheal, 15:30 UTC maintenance):

- **review** — PR reviews (structured verdict format: PASS/CONDITIONAL/REJECT) and issue/discussion triage (triggered by `@fro-bot` mention from OWNER/MEMBER/COLLABORATOR); manual dispatch requires a custom `prompt` input (validated, fails fast if absent)
- **maintenance** (15:30 UTC cron) — daily maintenance → rolling "Daily Maintenance Report" issue. Includes an **Upstream Modernization Watch** (Sundays UTC only) that surveys OpenCode/Fro Bot runtime docs but MUST NOT bump pinned agent SHAs
- **autoheal** (03:30 UTC cron) — fixes failing CI on open PRs, remediates critical/high security advisories, runs code-quality audits (build, coverage, accessibility, convention drift, AGENTS.md accuracy), lands lint/format fixes via PR, and verifies quality gates → "Daily Autohealing Report" issue

Pins **`fro-bot/agent@v0.107.1`** (SHA `e6b620bd51ae76e18cfe660d3aab490d29390eda`) as of 2026-09-03 — bumped from v0.97.0 (12 minors, 20 consecutive Renovate commits, crosses the cosmetic v0.100 line, still 0.x). `actions/checkout` pinned at v6.0.3 (`df4cb1c`). Secrets/vars: `OPENCODE_AUTH_JSON`, `FRO_BOT_PAT`, `FRO_BOT_MODEL`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`. Workflow file is 570 lines; body byte-identical to 2026-08-08 apart from the pin — same three-mode single file, dual crons (03:30 autoheal / 15:30 maintenance), `setup-pnpm` composite bootstrap, `contents/issues/pull-requests/discussions: write`, `concurrency` keyed on issue/PR/discussion number or schedule.

`AUTOHEAL_PROMPT` runs **7 categories**: 1 Errored PRs, 2 Security, 3 Code Quality & Repo Hygiene, 4 Developer Experience, 5 Quality Gates Verification, 6 Cross-Project Intelligence (inbound only), 7 Upstream Modernization Watch (Sundays UTC only, gated by an `IS_SUNDAY_UTC` env computed in a preceding step). It also declares an EXECUTION MODEL (serial writes, clean tree between mutations), a DEDUPLICATION clause, a SCOPE CAP, a DEPENDENCY OWNERSHIP boundary ceding routine bumps to Renovate, and a TRUSTED AUTHORS list (`renovate[bot]`, `dependabot[bot]`, `mrbro-bot[bot]`, `fro-bot`, Marcus). Both perpetual issues are managed by exact-title search with a 50,000-character body-rotation directive.

**Daemon liveness (2026-09-03):** workflow has 3,750 lifetime runs; the last 13 scheduled runs are all `success`, contiguous daily on both crons. The perpetual issues are live — #2153 "Daily Maintenance Report" (104 comments, last 2026-09-02), #2431 "Daily Autohealing Report" (59 comments, last 2026-09-03). See the 2026-09-03 section: **green and live is not the same as effective here.**

**Trigger economics.** Of the last 100 workflow runs, 87 concluded `skipped` — 63 `issues`, 12 `issue_comment`, 12 `pull_request` — against 13 `schedule` runs that actually executed. The bot's own writes to its perpetual issues re-fire the `issues` trigger, and the job-level `if:` then rejects them because `github.event.issue.user.login == 'fro-bot'`. Skipped jobs bill nothing, so the cost is queue noise and a run history in which real executions are 13% of rows. Worth knowing before reading run-history statistics on any repo with a self-writing rolling-report daemon.

### Repo-scoped named agent definitions (new 2026-08-08)

A new `.github/agents/` directory carries two Markdown agent-definition files with YAML frontmatter (`name`, `description`):

- **`reviewer.agent.md`** — "Reviewer" code-review agent scoped to this platform's stack; its checklist mirrors the repo's own invariants (no `as any`/`@ts-ignore`, Zod-schema-first, no `localStorage` for structured data, Web Crypto AES-GCM/PBKDF2, semantic tokens only, HeroUI patterns). Points the agent at root `AGENTS.md` + `docs/RULES.md`.
- **`test-writer.agent.md`** — "Test Writer" agent for the 5-tier test infrastructure (unit/E2E/accessibility/visual/performance), with a per-tier framework/location/command table and tier-specific authoring rules; points at `AGENTS.md` + `tests/AGENTS.md`.

This is the first observed instance in the surveyed ecosystem of **repo-committed, named agent definitions** (`*.agent.md`) distinct from the `AGENTS.md` convention-doc hierarchy — externalizing agent personas/checklists as first-class, version-controlled files the harness can select by name. It complements, rather than replaces, the AGENTS.md hierarchy: the agent files reference AGENTS.md as the source of truth for conventions. A new root-level `CODEOWNERS` also landed alongside.

**Note (2026-05-27 → confirmed 2026-06-19):** The two-workflow split observed in surveys before 2026-05-27 has consolidated. The standalone `fro-bot-autoheal.yaml` is no longer present in the workflow directory; `fro-bot.yaml` is the sole agent workflow. This aligns with the three-mode single-file pattern documented in [[marcusrbrown--marcusrbrown-github-io]] and other recent ecosystem updates.

## Conventions (from AGENTS.md)

- **Imports:** `@/` alias for `src/` paths
- **Types:** Zod schema first → `z.infer<typeof Schema>`
- **Handlers:** `handle` prefix (`handleSubmit`, `handleClick`)
- **Errors:** `catch (error_)` naming, re-throw for error boundaries
- **Async UI:** `.catch(console.error)` in `onPress`/`onClick`, never `void`
- **State:** Access via hooks only, never localStorage directly
- **Colors:** Semantic tokens only (`surface-primary`, `content-primary`)
- **Forbidden:** `as any`, `@ts-ignore`, `@ts-expect-error`, localStorage for data, hardcoded colors, `void asyncFn()`, nested buttons in Card, array index as key

## Notable Patterns

- **Local-first architecture:** All data stays in the browser via IndexedDB. API keys encrypted with AES-GCM/PBKDF2. No server-side storage.
- **Provider abstraction:** UI is fully decoupled from LLM SDKs. Adding a new provider means extending `BaseLLMProvider` and registering it.
- **RFC-driven design:** 13 RFCs document major architectural decisions, from storage foundations to desktop app (Tauri) aspirations.
- **Aggressive quality gates:** 5 distinct test dimensions (unit, E2E, accessibility, visual, performance) with CI enforcement.
- **Consolidated Fro Bot workflow:** A single `fro-bot.yaml` carries review/triage, maintenance, and autoheal as discrete `mode`-gated paths with detailed structured prompts.
- **Manual chunk splitting:** Vite config defines explicit `manualChunks` for React, Router, HeroUI, AI libs, Monaco, and utilities.
- **Cross-tab sync:** `cross-tab-sync.ts` service for multi-tab data consistency via IndexedDB.
- **Client-side document ingestion:** `pdfjs-dist` and `mammoth` parse PDF/DOCX entirely in the browser, keeping the local-first invariant intact for knowledge-base uploads; `jszip` + `file-saver` handle backup/restore export without a server round-trip.
- **pnpm workspace config split (2026-07):** With the pnpm v11 cutover, `overrides`, `allowBuilds`, and pnpm settings moved from `package.json` into `pnpm-workspace.yaml` — the pnpm-11-idiomatic location for these directives.
- **Repo-scoped named agents (2026-08):** `.github/agents/*.agent.md` externalizes review/test-authoring personas as frontmatter-tagged, version-controlled files the harness can select by name — a step beyond the AGENTS.md convention-doc hierarchy toward first-class, per-role agent definitions. The agent files defer to AGENTS.md for canonical conventions rather than duplicating them.
- **Tiered test reporting as first-class code (observed 2026-09-03):** `scripts/lib/` mirrors the 5-tier test model in two parallel module families — `parsers/{accessibility,coverage,e2e,performance,visual}.ts` and `formatters/{same five}.ts` — behind `github-comments.ts` and `job-summary.ts`. Adding a test tier means adding one parser and one formatter, and the CI "Generate … Report" jobs need no new logic. A cleaner separation than most repos in the fleet manage, and it is the reason the report jobs are three-line `node scripts/report-test-results.ts --type X` invocations.
- **Anti-pattern, delivery contract split across two documents (2026-09):** the workflow prompt grants push/PR authority, the job grants the write permissions to back it, and the harness resolves a delivery mode that forbids both. All three artifacts are internally consistent; the system is not. Failure is silent and the run is green. See the 2026-09-03 section.

## Open Questions

- **Why did `fro-bot` PR creation stop on 2026-07-29,** three weeks before `working-dir` delivery first appears in the report stream (2026-08-20)? The delivery break explains the file-write drought from 08-20 forward but not the preceding gap. Answering it likely needs the closed-PR history and the run logs for late July.
- **Is the `working-dir` mode resolved by the harness or by operator configuration?** The workflow passes no delivery-mode input — `with:` carries only `auth-json`, `github-token`, `model`, `omo-providers`, `opencode-config`, `prompt`, `timeout` — so it is resolved inside `fro-bot/agent`, possibly via `OPENCODE_CONFIG`. Settling this decides whether the fix belongs in this repo's workflow or in [[fro-bot--agent]].
- **How many other repos in the fleet pin a v0.10x agent and lack a caller-side commit job?** This is a one-query fleet lint (`fro-bot/agent@v0.10*` in `uses:` with no subsequent commit/push step) and it is the highest-value follow-up from this survey. A silent delivery break reproduces wherever the same workflow shape was copied.
- **Does `pnpm audit` on `main` actually report clean?** The autoheal claims rest on a working tree that no longer exists. Nothing has verified the advisory state of the committed lockfile since the overrides stopped landing.

## Open Work Items

### As of 2026-09-03

- **Delivery pipeline is broken and is the only thing that matters here.** `fro-bot.yaml` needs a caller-side diff/commit/push/PR job after `Run Fro Bot`, or the agent needs a delivery mode that owns it. Until then every autoheal run is an expensive, honest, discarded rehearsal. Six days of identical recomputation are already on the record in #2431.
- **Seven HIGH advisories are outstanding and believed fixed.** The autoheal reports assert clean `pnpm audit --audit-level high`; the overrides that would produce it never landed. `browserslist`, `ip-address`, `ws`, `brace-expansion` have no override at HEAD; `undici`/`hono` are covered only by the two conflicted PRs #2586/#2587 (open since 2026-06-19, untouched since 2026-07-21).
- **The `fast-uri: '>=3.1.2'` floor is a candidate for the stale-floor defect** recorded fleet-wide on 2026-09-03 (`>=` floors prove a past minimum, not a current one, and no routine install moves a lockfile that already satisfies them). Not verified against the current advisory set on this repo; flagged for the next survey.
- **15 open PRs, none younger than 36 days**, six of them one root cause. The durable fix for the Ollama contrast cluster is one human-reviewed semantic-token change, not six competing patches — unchanged advice from 2026-08-08, now with the added observation that the cluster stopped growing because the daemon stopped delivering, not because it was resolved.
- **23 open issues, ~14 of which are single-day 2026-03 sweeps** the agent is structurally forbidden to close. #2142 is arguably already resolved.
- **`Vite 7` in both workflow prompts** — a one-line fix in a file the autoheal loop is forbidden to touch, so it needs a human or a dispatch.
- **PR #2165** — HeroUI v2 → v3 migration, open since 2026-03-28, last touched 2026-05-10, fails all checks, and exceeds the prompt's SCOPE CAP (the 2026-09-03 report measures it at 46 files / ~5.8k lines). Six consecutive surveys open. It has a matching 8-issue tracking bed (#2162, #2168–#2175). Either it gets human attention or the whole cluster should be closed as declined; leaving it is the one option that costs something every day.

### Carried from prior surveys

- **PR #2165** — HeroUI v2 → v3 migration (authored by `fro-bot`, long-running — still open as of 2026-07-14; HeroUI/`@heroui/react` still pinned at 2.8.10). Now four consecutive surveys open.
- **PR #2620 resolved** — the pnpm v10 → v11 `[SECURITY]` bump has **landed**. Root now declares `packageManager: pnpm@11.9.0`; first pnpm major boundary crossed in this repo's survey series (mirrors the same cutover in [[marcusrbrown--sparkle]] to 11.10.0).
- **Accessibility autoheal cluster (Ollama contrast) — still unresolved, now SIX open PRs:** #2692, #2673, #2672, #2674, #2665, #2664 (all `fro-bot`, all targeting Ollama status-chip / settings contrast). The batch of four from 2026-07-14 has grown by two (#2692/#2674 added) with none landing. Three consecutive surveys of the same a11y theme, monotonically accreting — the contrast daemon the autoheal loop keeps re-summoning but can't exorcise. The loop generates fresh patches faster than it merges them; the durable fix is one human-reviewed contrast token change, not eight competing PRs.
- **Security override PRs still open:** #2587 (undici pin), #2586 (hono pin) — `fro-bot` autoheal remediations, unmerged across three surveys.
- **`fro-bot` test-hygiene PRs:** #2599 (`test(knowledge): remove unsafe spy casts`), #2693 (`test(e2e): stabilize archive restore flow`, new), #2688 (`fix(a11y): add skip-link focus target`, new) — open.
- **`mrbro-bot` dependency PRs:** #2662 (non-major deps), #2440 (`@bfra.me/eslint-config` v0.51.1), #2320 (react monorepo).
- **38 open issues** (as of 2026-08-08, up from 36) — continued slow accretion; likely autoheal/maintenance issue churn, not surveyed in detail under the read constraints. Stars 2 → 1. _(Annotated 2026-09-03: this figure is `open_issues_count`, which counts pull requests too. The 2026-09-03 decomposition is 23 issues + 15 PRs at the same total of 38. Every "open issues" number in the rows above and in the Survey History table is subject to the same correction.)_

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `60bd62e` | Initial survey |
| 2026-04-24 | `0bb8eed` | Dependency-only delta: `fro-bot/agent` v0.40.2→v0.41.4, `vite` 8.0.8→8.0.9, `@langchain/langgraph` 1.2.8→1.2.9, `eslint` 10.2.0→10.2.1, `uuid` v14 security patch, `@typescript/native-preview` 7.0.0-dev.20260419.1, `actions/setup-node` v6.4.0, `bfra-me/.github` v4.16.8. No structural or application code changes. |
| 2026-05-27 | `aac0103` | Five-week delta. **Renovate preset crossed v4 → v5.2.0 boundary (#2435, 2026-05-13).** `fro-bot/agent` advanced through 8 versions: v0.41.4 → v0.42.5/.6/.7/.8/.9/.10 → v0.43.0/.1/.3 → v0.44.3 → v0.45.0. Workflow consolidation: `fro-bot-autoheal.yaml` folded into `fro-bot.yaml` as `autoheal` mode (three-mode single-file pattern). Vite 8.0.9 → 8.0.14; LangChain monorepo bumps (`langchain` → 1.4.2, `@langchain/core` → 1.1.48, `@langchain/openai` → 1.4.7, `@langchain/anthropic` → 1.4.0, `@langchain/langgraph` → 1.3.2); TailwindCSS 4.2.2 → 4.3.0; React Router 7.14.1 → 7.15.1; Zod 4.3.6 → 4.4.3; Vitest 4.1.4 → 4.1.7; `@vitest/eslint-plugin` 1.6.18 newly added; ESLint 10.2.1 → 10.4.0; `@bfra.me/prettier-config` → 0.16.9; `@bfra.me/tsconfig` → 0.13.1; Node 24.15.0 → 24.16.0; pnpm 10.33.0 → 10.33.4; `@typescript/native-preview` advanced to 7.0.0-dev.20260523.1; `bfra-me/.github` updated through v4.16.12 → v4.16.19. No structural or application-code changes — exclusively dependency hygiene and workflow consolidation. |
| 2026-06-08 | `36b50c9` | Eleven-day delta. `fro-bot/agent` v0.45.0 → v0.57.0 (SHA `4470582693390235d4ab6fce1049373225025590`). New `opencode-config` secret input added to agent step. `actions/checkout` pinned at v6.0.3 (`df4cb1c`). Dependency bumps: `langchain` 1.4.2 → 1.4.4, `@langchain/langgraph` 1.3.2 → 1.3.5, `vite` 8.0.14 → 8.0.16, `react-router-dom` 7.15.1 → 7.17.0, `openai` → 6.42.0, `dexie` 4.4.2 → 4.4.3, `vitest` 4.1.7 → 4.1.8, `@vitest/eslint-plugin` 1.6.18 → 1.6.19, `@vitest/coverage-v8` 4.1.7 → 4.1.8, `eslint` 10.4.0 → 10.4.1, `@types/node` → 24.12.4, `lucide-react` → 0.577.0, `lint-staged` → 16.4.0, `pnpm` 10.33.4 → 10.34.1, `@typescript/native-preview` → 7.0.0-dev.20260604.1. Accessibility fix: removed nested sidebar landmark (PR #2525). AGENTS.md updated for Vite 8 alignment. No structural or application-code changes. |
| 2026-06-19 | `182e23d` | Eleven-day, 50-commit delta — exclusively dependency/workflow hygiene (changed files: `.github/renovate.json5`, `.github/workflows/{fro-bot,main,renovate,update-repo-settings}.yaml`, `.tool-versions`, `package.json`, `pnpm-lock.yaml`). `fro-bot/agent` v0.57.0 → v0.70.0 (SHA `60e600f39316758524f4fefe4c8a44f5bb25b089`). Renovate preset `marcusrbrown/renovate-config` 5.2.0 → 5.2.3; `bfra-me/renovate-config:automerge.json5` 5.2.1 → 5.2.3. Node 24.16.0 → 24.17.0; pnpm 10.34.1 → 10.34.3. Dependency bumps: `@langchain/core` 1.1.48 → 1.1.49, `@langchain/anthropic` 1.4.0 → 1.4.1, `@langchain/langgraph` 1.3.5 → 1.4.2, `langchain` 1.4.4 → 1.4.5, `tailwindcss`/`@tailwindcss/vite` → 4.3.1, `@playwright/test` → 1.61.0, `vitest`/`@vitest/coverage-v8` → 4.1.9, `@vitest/eslint-plugin` → 1.6.20, `eslint` → 10.5.0, `prettier` → 3.8.4, `@types/node` → 24.13.2, `@types/react` → 19.2.14, `@typescript/native-preview` → 7.0.0-dev.20260615.1. No structural or application-code changes. Open issues 25 → 22. |
| 2026-07-14 | `a6f661f` | Two-week delta with a **pnpm major cutover** and new runtime dependencies (not pure hygiene). Changed surfaces: `package.json`, `pnpm-workspace.yaml` (**overrides/allowBuilds migrated here from `package.json`**), `.github/renovate.json5`, `.github/workflows/fro-bot.yaml`, `pnpm-lock.yaml`; new root files observed (`RFCS.md`, `redocly.yaml`, `playwright-{visual,performance}.config.ts` — visual/perf Playwright configs now split out). **pnpm 10.34.4 → 11.9.0** (PR #2620 landed — first pnpm major boundary here). `fro-bot/agent` v0.79.4 → **v0.85.1** (SHA `fc1439327e826efc6904545cdf3d7ab812e9c286`, PR #2670). Renovate preset `marcusrbrown/renovate-config` 5.2.3 → 5.2.4. Node 24.18.0 unchanged. New/confirmed document-processing + UI deps: `pdfjs-dist` 5.7.284, `mammoth` 1.12.0, `jszip` 3.10.1, `file-saver` 2.0.5, `next-themes` 0.4.6, `react-swipeable` 7.0.2, `@react-aria/ssr` 3.10.1, `@tailwindcss/typography` 0.5.20. Dependency bumps: `vite` 8.1.0 → 8.1.3, `react-router-dom` 7.18.0 → 7.18.1, `tailwindcss`/`@tailwindcss/vite` 4.3.1 → 4.3.2, `prettier` 3.8.5 → 3.9.4, `@typescript/native-preview` → 7.0.0-dev.20260703.1. LangChain 1.5.x line, HeroUI 2.8.10, Zod 4.4.3, MCP 1.29.0, Monaco 4.7.0 unchanged. HeroUI v3 PR #2165 still open (4th survey); Ollama a11y-contrast autoheal cluster regenerated as #2673/#2672/#2665/#2664; undici/hono security pins #2587/#2586 still open. Open issues 23 → 36. |
| 2026-08-08 | `f6117f0` | ~3.5-week delta. **First structural change since the 2026-06-30 `setup-pnpm` action: new `.github/agents/` directory** with two frontmatter-tagged, harness-selectable named agent definitions — `reviewer.agent.md` (code-review persona encoding repo invariants) and `test-writer.agent.md` (5-tier test-authoring persona). New root `.github/CODEOWNERS`. `fro-bot/agent` v0.85.1 → **v0.97.0** (SHA `3f19f0223772aaf2862c98efba89557b8070ba57`, +12 minors); `actions/checkout` v6.0.3 and three-mode/dual-cron/`setup-pnpm` structure otherwise unchanged. **`pdfjs-dist` crossed v5 → v6 major** (5.7.284 → 6.2.108). Vite 8.1.3 → 8.2.0; ESLint 10.6.0 → 10.8.0; Prettier 3.9.4 → 3.9.6; `@playwright/test` 1.61.1 → 1.62.1; tailwindcss/`@tailwindcss/vite` 4.3.2 → 4.3.3; `@vitejs/plugin-react-swc` 4.3.1 → 4.3.3; LangChain line advanced (`langchain` 1.5.2 → 1.5.4, `@langchain/core` 1.2.1 → 1.2.4, `@langchain/openai` 1.5.3 → 1.5.5, `@langchain/anthropic` 1.5.1 → 1.5.3, `@langchain/langgraph` 1.4.7 unchanged); react-router-dom 7.18.1 → 7.18.2; `openai` 6.45.0, `lru-cache` 11.5.1, `uuid` 14.0.1 confirmed. Renovate preset `marcusrbrown/renovate-config#5.2.4` unchanged; Node 24.18.0, pnpm 11.9.0 unchanged. HeroUI v3 PR #2165 still open (5th survey). **Ollama a11y-contrast cluster grew to six open PRs** (#2692/#2673/#2672/#2674/#2665/#2664); undici/hono security pins #2587/#2586 still open (3rd survey). Open issues 36 → 38; stars 2 → 1. |
| 2026-09-03 | `556bc73` | 26-day delta. **Tree effectively frozen — 342 blobs before and after, 0 added, 0 removed, 4 changed** (`fro-bot.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), zero `src/`/`tests/`/`docs/` movement. **Headline: the autoheal daemon has been running in `working-dir` delivery mode since 2026-08-20 with no caller-side commit step in `fro-bot.yaml`** — 15 days of recomputed, discarded fixes reported as completed work, all runs green; the claimed `browserslist`/`ip-address`/`ws`/`brace-expansion` overrides and the new `RFCs/AGENTS.md`/`.ai/AGENTS.md` are absent from the tree, and the five claimed AGENTS.md drift repairs are byte-identical to 2026-08-08. The bot self-diagnosed it on 2026-09-03 in #2431. Mechanism: **Renovate bumps a harness pin as a version, not an interface** — `fro-bot.yaml`'s last 20 commits are all agent-pin bumps (v0.96.3 → **v0.107.1**, SHA `e6b620b`, 12 minors in 27 days) with zero body edits. Second, independent stall: **no `fro-bot` PR since 2026-07-29** (15 open PRs, none younger than 36 days); the Ollama a11y-contrast cluster is **frozen at six**, every one `updated_at` = creation — superseding the 2026-08-08 "monotonically accreting" reading. DEDUPLICATION clause failure confirmed 6× on the contrast cluster and again on duplicate issues #2171/#2173. **Three required status checks pass by not running** (`Deploy` skips on all PRs; `E2E Test Coverage`/`E2E Test Report` skip on paths-filter miss; `Run Tests`/`Build` no-op on cache hit, build key omitting `vite.config.ts`/`src/index.css`/`.tool-versions`). Rolling reports carry **7 distinct heading formats in 12 days** with no stable machine marker. Both prompts still describe the stack as "Vite 7" against actual **8.2.2**, and `PR_REVIEW_PROMPT` leaks two scheduled-mode directives. Prompt authorizes push/PR; harness forbids it; harness wins silently. Deps: pnpm 11.9.0 → **11.11.0**, Vite 8.2.0 → 8.2.2, ESLint 10.8.0 → **10.9.1**, Vitest 4.1.10 → 4.1.11, react-router-dom 7.18.2 → 7.18.3, LangChain line → 1.5.10/core 1.2.9/openai 1.5.10/anthropic 1.5.8, `@bfra.me/prettier-config` → 0.16.11, `@bfra.me/tsconfig` → 0.13.2, jsdom → 29.1.1, eslint-plugin-react-hooks → 7.0.1; new `minimumReleaseAgeExclude` block in `pnpm-workspace.yaml` (exact-version holes in a pnpm-default release-age cooldown). Corrections: notebooks restructured before 2026-08-08 (three `01-*.ipynb` → `agents/analysis/code-analyzer.ipynb` + `templates/agent.ipynb`) and carried forward unverified; `.ai/` is an 11-file planning corpus, not configuration; `scripts/` added to the directory table; "open issues" in all prior rows is `open_issues_count` (issues **+** PRs) — 38 today = 23 + 15. Counts: 1 star, 1 watcher, 0 forks. |
| 2026-06-30 | `174e517` | Eleven-day, 41-commit delta — dependency/workflow hygiene plus one CI structural change. Changed files: `.github/actions/setup-pnpm/action.yaml` (**new**), `.github/workflows/{fro-bot,main,renovate,update-repo-settings}.yaml`, `.tool-versions`, `package.json`, `pnpm-lock.yaml`. **New `setup-pnpm` composite action** centralizes pnpm/Node/Playwright bootstrap across all four workflows (adapted from `bfra-me/works` `pnpm-install`; pins `pnpm/action-setup@v5.0.0`, `actions/setup-node@v6.4.0`, `actions/cache@v5.1.0`) — DRY consolidation, no behavior change. `fro-bot/agent` v0.70.0 → v0.79.4 (SHA `b3384d37fb3c66e4249c0fb35037c6d244f34314`). Renovate preset unchanged (`marcusrbrown/renovate-config#5.2.3`, `bfra-me/renovate-config:automerge.json5#5.2.3`). Node 24.17.0 → 24.18.0; pnpm 10.34.3 → 10.34.4. Dependency bumps: `langchain` 1.4.5 → 1.5.2, `@langchain/core` 1.1.49 → 1.2.1, `@langchain/openai` 1.4.7 → 1.5.3, `@langchain/anthropic` 1.4.1 → 1.5.1, `@langchain/langgraph` 1.4.2 → 1.4.7, `vite` 8.0.16 → 8.1.0, `react-router-dom` 7.17.0 → 7.18.0, `dexie` 4.4.3 → 4.4.4, `openai` → 6.45.0, `@playwright/test` 1.61.0 → 1.61.1, `eslint` 10.5.0 → 10.6.0, `prettier` 3.8.4 → 3.8.5, `@typescript/native-preview` → 7.0.0-dev.20260626.1. HeroUI (`@heroui/react` 2.8.10), Monaco (4.7.0), Zod (4.4.3), `@modelcontextprotocol/sdk` (1.29.0) unchanged. No application-code changes. Open issues 22 → 23; PR #2165 (HeroUI v3) still open; new autoheal PRs — Ollama a11y contrast (#2628/#2612/#2557) and security pins undici #2587 / hono #2586. |
