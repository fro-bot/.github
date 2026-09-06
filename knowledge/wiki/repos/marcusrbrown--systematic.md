---
type: repo
title: marcusrbrown/systematic
created: 2026-04-24
updated: 2026-09-05
sources:
  - url: https://github.com/marcusrbrown/systematic
    sha: ef02119abd801487dc0e53a43ac2d6b6433873ab
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/systematic
    sha: 420ef650215a9ca8cefa01f125e02434e351952e
    accessed: 2026-05-06
  - url: https://github.com/marcusrbrown/systematic
    sha: 9b7570782190d540b4d57abdd94cf7ca8e1984f1
    accessed: 2026-05-28
  - url: https://github.com/marcusrbrown/systematic
    sha: 4d2c123f7f5568bba66433eb2a4e51c5ce42985c
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/systematic
    sha: 11b12bfae2433577db84821b5788a99f339243c9
    accessed: 2026-06-19
  - url: https://github.com/marcusrbrown/systematic
    sha: c2c43fd828b324c31f93a1c22455caab2aa708e0
    accessed: 2026-07-01
  - url: https://github.com/marcusrbrown/systematic
    sha: 4eecc77c6482895698645748beff0f336142bc64
    accessed: 2026-07-15
  - url: https://github.com/marcusrbrown/systematic
    sha: 9bceff393c4d14c76b01625b9268d08d37fc4f01
    accessed: 2026-09-05
tags:
  - opencode
  - plugin
  - ai
  - workflow
  - typescript
  - bun
  - biome
  - semantic-release
  - npm
  - zod
  - json-schema
  - slash-commands
  - conventional-commits
  - multi-harness
  - pi
  - claude-code
  - workflow-guard
  - receipts
  - capability-matrix
  - model-profiles
  - tree-sitter
  - evals
related:
  - fro-bot--systematic
  - opencode-plugins
  - github-actions-ci
  - pi-coding-agent
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--dotfiles
  - marcusrbrown--copiloting
  - marcusrbrown--gpt
  - marcusrbrown--vbs
  - marcusrbrown--cortexkit-anthropic-auth
node_id: R_kgDORAJegA
---

# marcusrbrown/systematic

Compound-engineering workflow system for AI coding harnesses. Published to npm as `@fro.bot/systematic`. Adapted from the [Compound Engineering Plugin (CEP)](https://github.com/EveryInc/compound-engineering-plugin) for Claude Code, now evolving independently.

**As of v3 this is no longer "an OpenCode plugin."** It is a single content source with three shipped harness adapters (OpenCode, Pi, Claude Code) and three documented portability targets. Everything below the 2026-09-05 section that says "OpenCode plugin" is v2-era framing retained for history.

## Overview

| Attribute       | Value                                                |
| --------------- | ---------------------------------------------------- |
| Created         | 2026-01-24                                           |
| Surveyed        | 2026-09-05 (HEAD `9bceff39`, 2026-09-05T08:37:47Z, `fix(deps): update dependency web-tree-sitter to v0.27.0` #877, `mrbro-bot[bot]`) |
| Description     | "Compound-engineering loops for OpenCode, Pi, and Claude Code" (was OpenCode-only through v2) |
| Latest release  | **v3.16.1** (2026-09-05T08:39:16Z) — cut from the surveyed HEAD ~90 s before this survey read it |
| Language        | TypeScript (strict, ESM, zero classes by convention) |
| Runtime         | Bun (plugin/CLI build); `src/pi.ts` builds `--target node` |
| License         | MIT                                                  |
| Stars / forks   | 24 / 2                                               |
| Open items      | 10 — 8 issues + 2 PRs (see [Open Issues / PRs](#open-issues--prs)) |
| Homepage        | https://fro.bot/systematic                           |
| npm             | `@fro.bot/systematic` — 207 versions, `dist-tags: {latest: 3.16.1}` (no `v2` tag) |
| Default branch  | main (branches: `main`, `claude-code-plugin`, plus 2 in-flight) |
| node_id         | `R_kgDORAJegA` (repo id `1141005952`)                |

## 2026-09-05 survey — first direct source-side look at v3

The prior page carried a standing note that "a direct source-side survey is warranted" for the v3 architecture change. This is that survey. **245 commits** separate `4eecc77` (2026-07-15, v2.33.3) from `9bceff39`.

Two things about the interval are worth stating before the details, because they invert the fleet's usual shape:

- **Authorship inverts the fleet pattern.** `mrbro-bot[bot]` 129 / **`marcusrbrown` 112** / `fro-bot` 4. Nearly half the interval is human-authored. Every other repo on this wiki runs 90–100% bot churn; this is the one where a person is doing sustained architectural work, and it shows in the commit types: 18 `feat`, 43 `fix`, 39 `docs`, 32 `build`, 98 `chore`, 10 `ci`, 3 `test`, 1 `refactor`, 1 `perf`.
- **The v3 boundary is two days later than recorded, not two weeks.** `3.0.0` published **2026-07-17T02:09:38Z** — 48 hours after the last direct survey. The page previously dated the boundary to `v3.2.5` (2026-07-22); that was simply the first v3 version the downstream deploy target happened to expose. **Correction recorded, prior claim superseded.** Five v3 versions shipped on 2026-07-17 alone.

### The architecture change: one content source, three harnesses

This is the whole v3 thesis, and `package.json` states it more precisely than the README does:

```jsonc
"peerDependencies": {
  "@opencode-ai/plugin": "^1.1.30",
  "@earendil-works/pi-coding-agent": "^0.83.0",
  "typebox": "^1.1.38"
},
"peerDependenciesMeta": { /* all three marked optional: true */ }
```

**All three harness peers are optional.** The package installs and functions with none of them present — the harness is a capability discovered at load, not a dependency. Supporting evidence across the tree:

| Harness | Entry point | Install path | Ships |
| --- | --- | --- | --- |
| OpenCode (Tier 1) | `src/index.ts` → `dist/index.js` | `"plugin": ["@fro.bot/systematic@latest"]` | plugin hooks + `systematic_skill` tool |
| Pi (Tier 1) | `src/pi.ts` → `dist/pi.js`, declared under a top-level `"pi"` manifest key (`extensions` + `skills`) | `npx @fro.bot/systematic setup --harness pi` | extension + `./skills` |
| Claude Code (Tier 1) | `scripts/build-claude-code-plugin.ts` | `claude plugin marketplace add marcusrbrown/systematic` | generated bundle on a branch |

`bun run build` is now a three-stage command: `src/index.ts` + `src/cli.ts` at `--target bun`, then `src/pi.ts` at `--target node`, then `tsc --emitDeclarationOnly`. The Node target for Pi is not incidental — it is the compatibility surface that keeps the `engines.node >= 18` floor meaningful.

Four `src/lib/` modules and one entry point exist only for Pi: `pi-delegate-session.ts`, `pi-delegate-tool.ts` (25 KB), `pi-subagents-personas.ts` (18 KB), `pi-subagents-export.ts` (56 KB), plus `scripts/generate-pi-subagents-personas.ts` and 30 golden persona fixtures under `tests/fixtures/pi-subagents-personas/`. See [[pi-coding-agent]].

### `HARNESSES.md` — a capability matrix that marks its own unknowns

The most transferable artifact in the repo, and it ships **inside the npm tarball** (`"files"` includes `ATTRIBUTIONS.md` and `HARNESSES.md` alongside `dist`/`skills`/`agents`). It is a 20 KB, six-harness × five-capability matrix on an explicit two-tier model:

- **Tier 1, shipped adapter:** OpenCode, Pi, Claude Code.
- **Tier 2, documented portability target:** Codex CLI, Gemini CLI, GitHub Copilot.

Every cell carries a citation key (`[OC-1]`, `[PI-7]`, `[CC-9]`, `[GH-4]`…) resolved by an **Evidence registry** section at the end of the file. Cells the author could not verify are filled with the literal token **`UNVERIFIED` `[U]`** — Codex CLI and Gemini CLI carry it for subagent delegation and task tracking.

That last detail is the pattern worth stealing. Most capability tables are written to look complete; this one is written to be auditable, and it distinguishes *absent* from *unconfirmed*. A blank cell is indistinguishable from a false claim. `UNVERIFIED` is not.

The matrix is also where the README's marketing claim gets its honest correction. The README says skill and agent content is "identical across all three" and links to "where parity honestly ends." The matrix is that endpoint:

- **Pi** has *no* native blocking-question tool and *no* native task-tracking mechanism — both documented as prose fallbacks (numbered chat, visible list). Its delegate is deliberately bounded: sequential, **capped at 20 turns, depth-1, `noExtensions`**.
- **Claude Code** ships **no `systematic_skill` tool at all** — it uses the native Skill tool. `TodoWrite` is recorded as deprecated/disabled by default there in favour of `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`.

So content parity is real and capability parity is not, and the repo says which is which. **Contradiction noted rather than resolved:** open issue **#854** ("The workflow guard is OpenCode-only because of its state model, not because other harnesses can[not]") argues the largest subsystem in the codebase is bound to one harness for reasons of internal design, not external constraint. The tri-harness claim is honest about tools and still load-bearing about architecture.

### The new mass: workflow guard, receipts, and attestation

The v3 source tree is dominated by a subsystem that did not exist in v2. By byte count these are the two largest files in the repository:

| Module | Size | Role (inferred from name + test coverage) |
| --- | --- | --- |
| `src/lib/opencode-workflow-guard.ts` | 129,994 B | OpenCode-specific guard host |
| `src/lib/workflow-guard.ts` | 116,955 B | Harness-neutral guard core |
| `src/lib/receipt-readback.ts` | 63,225 B | Read-back verification of claimed work |
| `src/lib/receipt-ledger.ts` | 50,912 B | Append-only operation ledger |
| `src/lib/opencode-operation-observer.ts` | 40,197 B | Operation capture |
| `src/lib/receipt-classifier.ts` | 36,187 B | Operation classification |
| `src/lib/capability-snapshot.ts` | 36,204 B | Runtime harness capability probe (backs `HARNESSES.md`) |
| `src/lib/question-attestation.ts` | 25,646 B | Attestation for blocking-question flows |
| `src/lib/routing-resolver.ts` | 21,614 B | Model/profile routing |

Backed by 14 dedicated unit test files (`receipt-*.test.ts`, `workflow-guard*.test.ts`, `question-attestation.test.ts`) plus five integration suites including `receipt-workflow-guard-real-host.test.ts` and `receipt-workflow-dogfood.test.ts`.

**Direct dogfooding evidence, first-hand:** this survey ran under a Fro Bot agent session whose own system prompt carried a `SYSTEMATIC_WORKFLOW_GUARD` block (`protocolVersion: 2`, `state: unavailable`, `reasonCode: guard-unavailable`, `enforcement: observe`) and exposed `systematic_workflow_{start,complete,status,control}` tools. The deployed config schema's `workflow_guard` default is `{"mode": "observe", "debug": false}` — matching exactly. The guard is live in the ecosystem and currently ships in observe-only mode.

**New runtime dependencies tell the same story:** `tree-sitter-bash` 0.25.1 and `web-tree-sitter` 0.27.0 are now *runtime* `dependencies`, not devDependencies. A workflow plugin now ships a WASM grammar to parse shell. The only plausible consumer is the receipt classifier deciding what a command the agent ran actually *did* — you cannot classify `bash` by regex without being wrong in interesting ways. It is also a real supply-chain and bundle-size escalation for a package that used to depend on `js-yaml` + `jsonc-parser` + `zod` and nothing else. The surveyed HEAD is itself the `web-tree-sitter` 0.27.0 bump.

### Config schema: 10 → 12 top-level properties in under 24 hours

[[fro-bot--systematic]] fingerprinted the deployed schema on 2026-09-04 at **38,180 B / 74 `definitions` / 10 top-level properties / `sha256[:16] 0e82797b9f8f43ed`**, and adopted a byte/definitions/hash fingerprint precisely because property-counting had been measuring a header. Re-measured today at `https://fro.bot/systematic/schemas/v3/systematic-config.schema.json`:

| Metric | 2026-09-04 | 2026-09-05 | Δ |
| --- | --- | --- | --- |
| Bytes | 38,180 | **58,954** | +54% |
| `definitions` | 74 | **100** | +26 |
| Top-level properties | 10 | **12** | +2 |
| `sha256[:16]` | `0e82797b9f8f43ed` | **`1f9b7c48a4b6455c`** | changed |

The two new properties are **`profile`** and **`profiles`** — the "named model profiles with per-harness routing" feature that shipped as **v3.16.0** this morning. The fingerprint the sibling page adopted yesterday moved within a day, which is the strongest possible confirmation that the metric was worth adopting.

**Two corrections to the sibling page's structural probes**, both dated 2026-09-05:

1. The generator now emits `allOf` + `$ref` composition wrappers for the top-level objects. `properties.agents` and `properties.categories` are `$ref`s into `definitions`, so a shallow read of `additionalProperties` / `propertyNames` / key-count on either now returns nothing at all. The 09-04 measurements (`agents` = 74 keys, `additionalProperties: false`; `categories` open-keyed via `propertyNames`) were taken against a flatter emission and **cannot be reproduced by the same probe today**. The underlying asymmetry may well survive the refactor — this survey does not claim it was removed, only that the *instrument* broke. The byte/definitions/hash fingerprint survived the refactor; every structural probe did not. That is the argument for fingerprints in one observation.
2. `categories` remains reachable but resolves through composition rather than a direct object body.

The `profiles` description encodes a **trust boundary directly in the schema**, and it is the most security-relevant line in the artifact:

> Named routing-only overlay bundles, selectable by name via the profile field. Only valid in user config or `OPENCODE_CONFIG_DIR` config — **a project config may select a profile but may not define this field.**

A checked-in project config can *choose* a routing overlay but cannot *author* one. That is the correct direction: a cloned repository cannot silently redirect your agents to a model of its choosing, which is the same untrusted-input posture the workflow prompts take toward issue bodies. Full config surface is now: `$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `pi_subagents`, `profile`, `profiles`, `skills_as_commands`, `workflow_guard`.

### Catalog: 37 agents / 31 skills, and the 48-vs-49 mystery is solved

Confirmed source-side, matching the registry counts [[fro-bot--systematic]] has tracked as flat for ~6 weeks. The `agents/` tree holds 38 `.md` files, one of which is `agents/review/README.md`:

| Category | v2 (2026-07-15) | v3 (2026-09-05) |
| --- | --- | --- |
| `design/` | 3 | **1** (`design-iterator`) |
| `docs/` | 1 | **0 — category eliminated** |
| `document-review/` | 7 | 7 |
| `research/` | 7 | 7 |
| `review/` | 28 | **18** |
| `workflow/` | 5 | **4** |
| **Total** | **51** | **37** |

Categories went 6 → 5. The contraction is concentrated in `review/` (−10) and `design/` (−2). The README's advertised "31 bundled skills and 37 specialized agents" matches the tree exactly — a claim that is true, which is rarer than it should be.

**The long-running methodology note is now resolved.** Earlier surveys logged a discrepancy between 48 and 49 bundled skills and attributed it to `release-notes-narrative` "shipping outside the bundled `skills/` tree." That is now literally true and visible: `release-notes-narrative` lives at `.agents/skills/release-notes-narrative/` alongside `generating-project-docs` and `running-with-without-evals`. The repo grew a project-scoped skill directory distinct from the published one. **Prior methodology caveat closed.**

Skills dropped since v2 include the specialized long tail (`dhh-rails-style`, `dspy-ruby`, `gemini-imagegen`, `proof`, `rclone`, `andrew-kane-gem-writer`) and the two deprecated entries (`orchestrating-swarms`, `claude-permissions-optimizer`). Skills added include `agent-native-architecture`, `agent-native-audit`, `deepen-plan`, `deploy-docs`, `document-review`, `onboarding`, `report-bug-ce`, `reproduce-bug`, `resolve-pr-feedback`, `test-browser`, `todos`, `compound-docs`. The v3 contraction was a **narrowing to the engineering loop**, not an across-the-board cut.

### A bundled skill that is a build artifact of an npm package

`agent-browser` is a `devDependency` pinned at **0.34.0**, and `skills/agent-browser/` is *generated* from it by `scripts/generate-agent-browser-skill.ts`, with `agent-browser:drift` enforced as its own CI step in `main.yaml`.

This is a distinct pattern from vendoring: the skill content is derived, the derivation is scripted, and drift between the pinned package and the committed skill fails the build. It means a Renovate bump of `agent-browser` cannot land without regenerating the skill — Renovate's `postUpgradeTasks` and the repo's own `postupgrade` script (`build && agent-browser:build && schema:generate && review-schema:generate && generate-registry`) exist to close exactly that loop. Six drift/integrity gates now run in the `Build` job: content integrity, Claude Code plugin build + integrity, agent-browser skill drift, registry drift, config schema drift, and review artifact schema drift.

### The Claude Code install path is a release-gated branch that nothing gates

`.claude-plugin/marketplace.json` points Claude Code users at `source.ref: "claude-code-plugin"` — a generated branch, never hand-edited (`HARNESSES.md`: the bundle is "built and identifier-translated in CI from `skills/`, never committed"). It is published by a dedicated `main.yaml` job:

```yaml
publish-claude-code-plugin:
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        && needs.release.outputs.new-release-published == 'true'
  needs: [build, typecheck, lint, test, release]
```

Release-gated, exactly like the `gh-pages` fan-out in [[fro-bot--systematic]]. Systematic now has **two release-gated downstream artifacts** (docs/registry/schema site, and the Claude Code plugin branch), so the *measure the gate, not the tree* rule from that page applies twice here. Branch state at survey time: head `958d4227`, 2026-09-04T17:56:38Z, `build(claude-code): publish marcusrbrown/systematic@4e99f0e9` — i.e. built from the `v3.15.1` release, ~15 h before `v3.16.0`/`v3.16.1`. Lag is expected and correct for a release-gated target.

**The footgun is what protects it: nothing.** Required status checks on `main` are `[Build, Docs Build, Fro Bot, Typecheck, Lint, Test, Registry, Release, Analyze (typescript), CodeQL, Renovate / Renovate]`. `Publish Claude Code Plugin` is **not** in that list, and by construction it cannot be — it only runs on `push` to `main` after a release, never on a `pull_request`. So the job that feeds one of three advertised install paths runs exclusively post-merge, un-gated, and a persistent failure would present to users as "Claude Code install quietly serves stale content" while `main` stays green. This is the same shape as the required-check-that-cannot-fail-loudly case in [[bfra-me--ha-addon-repository]], reached from the opposite direction: there a required check silently skipped, here a critical job was never required at all. The mitigation that exists is a `Guard built bundle before publish` step inside the job; the gap is that no one is watching whether the job ran.

### Fro Bot: three modes → two, two crons → one, and a Sunday that is not a cron

`fro-bot.yaml` is now **711 lines** and pins `fro-bot/agent@504e86ab` (**v0.108.1**) — ahead of every other pin recorded on this wiki, making systematic the current ecosystem version leader. `actions/checkout` crossed to **v7.0.1** (SHA-pinned), `oven-sh/setup-bun` v2.2.0.

The structural change matches the consolidation pattern the rest of the fleet converged on ([[bfra-me--github]], [[marcusrbrown--vbs]], [[marcusrbrown--mothership]], [[marcusrbrown--mrbro-dev]] #234, [[bfra-me--works]] #4366):

| | v2 (2026-07-15) | v3 (2026-09-05) |
| --- | --- | --- |
| Dispatch modes | `review` / `maintenance` / `autoheal` | **`review` / `autoheal`** |
| Crons | `0 9` Mon + `30 3` daily | **`30 3` daily only** |
| Prompts | 3 | **4** (`PR_REVIEW`, `ISSUE_TRIAGE`, `AUTOHEAL`, + verbatim passthrough) |
| Autoheal categories | 4 | **10** |

**Where the weekly work went is the interesting part.** `maintenance` was not deleted, it was demoted into a day-gated *category* of the daily pass. A step runs `date -u +%u` and exports `IS_SUNDAY_UTC`; category 10 (UPSTREAM MODERNIZATION WATCH) begins "Runs only when IS_SUNDAY_UTC=true… On other days, skip entirely and omit the category 10 section from the daily report."

That is a genuinely better shape than a second cron, and worth generalizing. A weekly cron is a second entry point with its own routing branch, its own failure surface, and its own scheduled-run history to keep alive — and GitHub's 60-day inactivity shutoff kills schedules per workflow, so a rarely-firing cron is exactly the kind of thing that dies unnoticed (see [[marcusrbrown--cortexkit-anthropic-auth]]). Folding cadence into a conditional category means the weekly work rides the daily heartbeat: if the daily pass is alive, the Sunday pass is alive. One liveness signal instead of two.

The env-var handoff is documented inline with the reason for its fallback — `IS_SUNDAY_UTC: ${{ env.IS_SUNDAY_UTC || 'false' }}`, because the detection step only runs on `schedule`/`workflow_dispatch` and category 10 has no other consumer.

**New: issue triage as a first-class mode.** `issues: [opened, edited]` now routes to `ISSUE_TRIAGE_PROMPT`, gated on non-bot authors with `OWNER`/`MEMBER`/`COLLABORATOR` association. It is read-only by construction — no labels, no assignment, no close/reopen, no code — and maintains **exactly one** bot comment anchored by a body marker `<!-- fro-bot-triage -->`, updated only "when findings materially change." The comment is explicitly written for a cold-start LLM: "include evidence, exact paths when known, constraints or do-not-retry warnings, and a concrete verification method."

Note the internal inconsistency, because it is instructive: the *triage comment* uses a body marker for identity, which is precisely the remedy prescribed in [[github-actions-ci]]'s title-fragmentation finding — while the *daily report* still uses exact-title matching. The repo has the better technique in hand and applies it to the newer surface only.

**Observed routing details** in the 7-branch `PROMPT` ternary:

- The `workflow_call` and `workflow_dispatch` prompt-passthrough branches come first, with a long inline comment explaining that reordering them would silently break the release-notes-narrative contract. That contract is live: the two `workflow_dispatch` runs at 08:15 and 08:39 today correspond exactly to the `v3.16.0` and `v3.16.1` publishes.
- Branch 4 (`workflow_dispatch && mode == 'autoheal'`) is **subsumed by branch 5** (`workflow_dispatch` unqualified), which yields the identical `AUTOHEAL_PROMPT`. It is dead weight in a ternary whose own comment instructs future editors to "walk every event_name × mode × cron combination explicitly."
- **Comment-triggered events have no branch at all.** `issue_comment`, `pull_request_review_comment`, and `discussion_comment` pass the job's `if:` gate (on `@fro-bot` mention + association) and then fall through to `PROMPT: ''`, delegating prompt selection entirely to the agent action's default behaviour. Recorded as observed structure; whether that is intentional is not determinable from the workflow alone.

The fork-guard asymmetry documented in v2 (#451) survives verbatim, now with a four-row inline comment table explaining why `issue_comment` needs an explicit `gh api` fork check while the other three PR-adjacent events do not.

### The perpetual report is rotating correctly, and that is the problem

The autoheal prompt's SINGLE ISSUE MANAGEMENT block is the most carefully specified retention policy on this wiki. It mandates deterministic exact-title matching, forbids fuzzy/contains matching in so many words, enumerates the three legacy title schemes eligible for migration, restricts "bot-authored" to logins exactly `fro-bot` or `mrbro-bot[bot]`, and prescribes the write mechanic in detail: build the complete body in a local temp file, verify heading + byte count + dated-section retention, then update **once** with `gh issue edit --body-file`.

Every clause is a scar. `--body-file` rather than `--body` is the exact defect [[marcusrbrown--dev-like]] hit when a report evaporated as the literal string `@/tmp/opencode/autoheal-comment-final.md`. The exact-title allowlist is the fleet's title fragmentation ([[github-actions-ci]]) hard-coded as history. And the archival clause is the direct answer to [[marcusrbrown--cortexkit-anthropic-auth]], where a 50,000-character rotate directive was stated and never executed while the body grew to 54,813.

**Here the directive is executed faithfully — and the retention promise is arithmetically impossible.** Issue **#153** at survey time: **49,145 characters, 158 comments, and exactly one dated section.** The bot's own archival note is a self-recorded audit trail:

> _[Archived 4 older dated sections … on 2026-08-20 — body had grown to 61,736 characters; archived 6 more … on 2026-08-27 at **139,930 characters**; archived 5 more … on 2026-08-30 at 94,960; archived 2 more on 2026-08-31 at 47,616; then 1 per day thereafter … **Single-section retention is the measured steady state: a complete section has a ~31,000-character floor, so two cannot coexist under the 50,000 cap.** See the Needs Human Attention entry above for why the "30 most recent sections" clause is arithmetically unsatisfiable.]_

The prompt asks for two things at once: cap the body at ~50,000 characters, **and** retain the 30 most recent dated sections. At a ~31,000-character floor per section, 50,000 ÷ 31,000 = 1. The policy promises 30 and delivers 1 — off by a factor of thirty, and no amount of correct execution can fix it, because the constraint pair has no solution.

The damage is not cosmetic. Category 8 (PROGRESSIVE IMPROVEMENT) instructs the agent to "read the prior Daily Autohealing Report update" and classify findings as **first-seen, recurring, resolved, or do-not-retry** — recurrence detection over a history the archival policy deletes daily. Category 5 asks it to "report deltas, first-seen items, recurring items, and resolved items instead of repeating unchanged inventories," against the same vanished baseline. Two policies in the same prompt, in direct conflict, and the conflict is only visible if someone divides.

The generalizable rule: **a prose budget with two independent numeric constraints is a claim you must check by arithmetic before shipping.** `cap ÷ per-item-floor ≥ retention-count` or the retention count is fiction. And note where the finding lives — the bot discovered it, wrote it into the archival note and a Needs Human Attention entry, and filed it *inside the artifact being truncated*. Self-reporting is worth a great deal, but a finding stored in a rotating buffer is a finding with a shelf life. Also note the 139,930-character peak: the "approaching 50,000" trigger is evaluated by a model reasoning about prose, so overshoot is unbounded between passes.

### Daemon health: the control case

Against a wiki full of dead daemons, this one is unambiguously alive. **4,100 total `Fro Bot` runs; 130 scheduled runs; the last 15 consecutive scheduled runs all `success`**, unbroken daily from 2026-08-22 to 2026-09-05. All 8 workflows report `state: active` — none carry `disabled_inactivity` (contrast [[marcusrbrown--cortexkit-anthropic-auth]]). Issue #153 was written 2026-09-05T03:56, minutes after the 03:37 scheduled run, so the daemon is producing output and not merely exiting zero (contrast the same page's *A Run's Conclusion Measures the Harness, Not the Deliverable*).

One recurring noise source, confirming an existing finding rather than adding one: `issues: [opened, edited]` fires on every Renovate edit of the **Dependency Dashboard** (#15), producing `skipped` runs — three within 90 minutes during this survey. The bot-author filter works correctly; the runs still dispatch. Nth confirmation of the `issues: [edited]` no-op run storm in [[github-actions-ci]].

### `v2.33.4` — an orphan release with no channel

`v2.33.4` was published to npm at **2026-08-18T22:11:25Z**, *after* `v3.12.0` went out at 20:01 the same evening. A v2 maintenance backport, two months into the v3 line. Three observations, stated as observations:

- npm `dist-tags` contains **only** `latest: 3.16.1`. There is no `v2` or `maintenance` tag, so the release has no advertised channel; reaching it requires a version range or an exact pin.
- `.releaserc.yaml` declares `branches: [main]` and nothing else. As committed today it could not produce a `2.x` release.
- The repository currently has four branches — `main`, `claude-code-plugin`, `docs/model-profiles-guide`, `renovate/opencode` — so whatever branch cut `v2.33.4` no longer exists.

The mechanism is not recoverable from the surfaces this survey is permitted to read. What is recoverable is the end state: a published artifact that the project's current configuration cannot reproduce, cannot advertise, and has no branch to patch. Worth re-checking if a v2 consumer ever reports a problem.

### Release cadence: the drought ended, and the shape holds

[[fro-bot--systematic]] recorded a 10-day drought on 2026-09-04 and correctly diagnosed it as compositional — the interval held only `docs:` and `chore:` commits, so semantic-release published nothing. **The drought ended within hours of that survey**, which retroactively confirms the diagnosis rather than undermining it:

| Version | Published | Gap |
| --- | --- | --- |
| `3.15.0` | 2026-08-25T07:59:54Z | — |
| `3.15.1` | 2026-09-04T17:52:51Z | **10.4 d** |
| `3.16.0` | 2026-09-05T08:15:23Z | 14.4 h |
| `3.16.1` | 2026-09-05T08:39:16Z | **24 min** |

Burst-and-drought is the durable shape, not a v3.15 anomaly. Across the v3 line: 9 publishes on 2026-08-23 alone; a 9.2-day gap at `3.6.0 → 3.6.1`; a 3.5-day gap at `3.2.6 → 3.2.7`. Reporting a mean over this distribution manufactures a rhythm that never occurred — the rule [[github-pages]] recorded yesterday, re-confirmed with a fourth interval.

### Confirmed defect: `tsconfig.json` excludes everything but `src/`

Open issue **#897** ("Typecheck never covers tests/ or scripts/") is independently confirmed from the manifest. `tsconfig.json` sets `"include": ["src/**/*"]` with `"rootDir": "src"`, and `"typecheck": "tsc --noEmit"` runs that config unmodified. Outside coverage:

- **67 files** in `tests/unit/` plus 12 in `tests/integration/` — including `eval-runner.test.ts` (73 KB), `receipt-workflow-recovery.test.ts` (67 KB), `pi.test.ts` (55 KB).
- **16 files** in `scripts/` — including `run-evals.ts` (115 KB), `content-integrity.ts` (89 KB), `eval-cases/opencode.ts` (52 KB), `generate-config-schema.ts` (33 KB).

That is roughly 400 KB of unchecked TypeScript, and it includes the CI enforcement machinery: `content-integrity.ts` is the gate that enforces the repo's own conventions, and `Typecheck` is a required status check that never looks at it. Also unchecked are `tests/unit/fro-bot-workflow.test.ts` and `tests/unit/content-integrity.test.ts` — the tests asserting on the workflow and the gate. Category 7 of the autoheal prompt lists `bun run typecheck — 0 errors` as a quality gate, which it passes, correctly, on 42 of ~125 TypeScript files.

### Other durable structure

- **Docs / conventions layer, all new since v2:** `ARCHITECTURE.md` (16 KB — Bird's Eye Overview, Codemap, Codemap exclusions, **Invariants**, Data Flow, Skill Discovery and Fallbacks, Cross-Cutting Concerns), `STRUCTURE.md` (14 KB — directory layout + "Where to Add New Code"), `HARNESSES.md`, `ATTRIBUTIONS.md` (32 KB — the largest doc, consistent with a project that vendors and adapts upstream content). The autoheal prompt requires reading `AGENTS.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, and `docs/solutions/` *before taking action* — the docs are agent inputs, not decoration.
- **`docs/solutions/` holds 84 markdown learnings** — the compound-docs corpus, same convention as this repo's own `docs/solutions/`. New sibling dirs `docs/plans/` and `docs/promotion/`.
- **`evals/` promoted to a top-level concern** with `scripts/run-evals.ts` (115 KB), `scripts/eval-cases/opencode.ts` (52 KB), four JSON cases, and five eval test files (`eval-contract`, `eval-redaction`, `eval-runner`, `eval-artifact`, `eval-fixture`). `eval-redaction.test.ts` pairs with open issue **#796** ("ce:review artifacts retain verbatim private source indefinitely with no retention policy").
- **Golden-fixture config testing:** `tests/fixtures/config-corpus/` holds 14 numbered cases, each with an `input.jsonc` of 3–403 bytes and an `expected.opencode.json` of **~223 KB**. About 3 MB of committed golden output — roughly half the repo's 6 MB — pinning the full merged OpenCode config for each input. Extremely high-signal against merge-precedence regressions; also means any catalog change rewrites 14 files at once.
- **Registry format changed:** `registry/index.json` → **`registry/registry.jsonc`** (37 KB), with `registry:build` / `registry:drift` / `registry:validate` scripts and `scripts/generate-registry.ts` + `scripts/build-registry.ts` as separate programs. Two profiles (`omo`, `standalone`) under `registry/files/profiles/`.
- **`mise.toml` exists and pins nothing** — 39 bytes, `[env] _.path = ["./node_modules/.bin"]`. Notable only because [[mise]] elsewhere in the fleet is a toolchain pinner; here it is a PATH shim. Bun version is not pinned in-repo at all (`oven-sh/setup-bun` without a version input).
- **Branch protection gained a context:** the list now carries both `Analyze (typescript)` **and** `CodeQL`, where v2 had the single `CodeQL Analyze (typescript)`.
- **Biome schema drift, third occurrence.** `biome.json` declares `$schema: .../2.5.1/schema.json` while `@biomejs/biome` is pinned at **2.5.11** — 10 patches apart. This repo has fixed this exact drift twice (#533 → 2.4.16, #571 → 2.5.1) and [[marcusrbrown--opencode-copilot-delegate]] tracks its own running instance of it. It is not self-correcting because nothing asserts the two agree.
- **New `overrides` block** in `package.json`: `@earendil-works/pi-ai` 0.83.0 (lockstep with the Pi peer), `brace-expansion` ^5.0.8, `conventional-changelog-writer` >=9. The `>=` floor is the snapshot-not-guarantee shape recorded in [[github-actions-ci]] (2026-09-03).

### Dependency deltas (v2.33.3 `4eecc77` → v3.16.1 `9bceff39`)

| Package | 2026-07-15 | 2026-09-05 | Note |
| --- | --- | --- | --- |
| `typescript` | 6.0.3 | **7.0.2** | major |
| `@types/node` | 24.13.3 | **26.4.1** | two majors |
| `zod` | 4.4.3 | 4.5.4 | |
| `@biomejs/biome` | 2.5.3 | 2.5.11 | `$schema` still 2.5.1 |
| `@opencode-ai/plugin` / `sdk` | 1.17.18 | 1.18.21 | peer range still `^1.1.30` |
| `semantic-release` | 25.0.6 | 25.0.9 | |
| `markdownlint-cli` | 0.48.0 | 0.49.1 | |
| `js-yaml` | ^4.1.1 | ^4.3.1 | |
| `tree-sitter-bash` | — | **0.25.1** | new runtime dep |
| `web-tree-sitter` | — | **0.27.0** | new runtime dep |
| `@earendil-works/pi-coding-agent` | — | **0.83.0** | new (optional peer + devDep) |
| `typebox` | — | **1.3.25** | new (optional peer + devDep) |
| `@tintinweb/pi-subagents` | — | **0.14.3** | new devDep |
| `agent-browser` | — | **0.34.0** | new devDep; generates a bundled skill |
| `rimraf` / `conventional-changelog-conventionalcommits` / `semantic-release-export-data` | — | 6.1.3 / 10.4.0 / 1.2.0 | new devDeps |
| `ajv` / `ajv-formats` | 8.20.0 / 3.0.1 | unchanged | |
| `fro-bot/agent` | v0.90.0 | **v0.108.1** | ecosystem version leader |

`@opencode-ai/plugin` remains an **optional** peer at `^1.1.30` — a deliberately wide range for a package pinned at 1.18.21 in dev, and the reason [[opencode-plugins]] notes narrow peer ranges as the safer default when the host churns.

---

## Architecture (v2-era section — see the 2026-09-05 survey above for v3)

> **Superseded figures below.** The module table, the 51-agent / 48-skill counts, the three-mode workflow, the `schemas/v2/` path, and the v2 dependency table are retained as history. Where they conflict with the 2026-09-05 survey, the survey is current.

Two distinct parts:

1. **TypeScript source** (`src/`) — Plugin logic, tools, config handling, CLI
2. **Bundled assets** (`skills/`, `agents/`) — Markdown content shipped with the npm package

### Plugin Hooks

The plugin implements three OpenCode hooks:

- **`config`** — Discovers and merges bundled skills and agents into OpenCode configuration. Existing user/project config takes precedence. As of v2.32.0, removed bundled names listed in `disabled_skills`/`disabled_agents` are warn-and-ignored rather than rejected, so cleaning up a skill upstream no longer bricks configs that had disabled it (#534).
- **`tool`** — Registers the `systematic_skill` tool for on-demand skill loading.
- **`system.transform`** — Injects the "Using Systematic" bootstrap guide into system prompts.

### Source Modules (`src/lib/`)

| Module                    | Role                                           |
| ------------------------- | ---------------------------------------------- |
| `config-handler.ts`       | Config hook — merges bundled assets             |
| `config-schema.ts`        | Zod schema for `systematic.json` user config (v2.16+); typed bundled-name validation with IDE autocomplete (#384) |
| `config.ts`               | JSONC config loading and merging; surfaces every Zod issue in top-level error message (#398); project-local Systematic overrides global Systematic output (#370); v2.32.0 warn-and-ignore for removed bundled names in disable lists, stateless per-load dedup preserving raw config for merge precedence (#534) |
| `skill-tool.ts`           | `systematic_skill` tool factory                 |
| `skill-loader.ts`         | Skill content loading and formatting            |
| `skill-catalog.ts`        | Bootstrap-injected catalog of available skills (v2.18+, #365) |
| `bootstrap.ts`            | System prompt injection; SUBAGENT-STOP block + Instruction Priority section in `using-systematic` (#405); simplified skill usage guidance (#368) |
| `bundled-names.ts`        | Generated registry of bundled skill/agent names for typed validation |
| `agents.ts`               | Agent discovery (category from subdirectory)    |
| `agent-colors.ts`         | Per-category color assignments for agents       |
| `agent-overlays.ts`       | Model availability overlay for agent selection; memoized per OpencodeClient instance (#383); collapses empty cache/discovery to unknown status (#378, #372) |
| `model-availability.ts`   | Runs discovery before validation (#372, #376); upstream of overlay |
| `source-model-defaults.ts`| Default model assignments per agent/skill source |
| `skills.ts`               | Skill discovery (highest centrality in codebase)|
| `commands.ts`             | Command discovery + registration of discovered skills as slash commands (v2.33.x, #592–#594); honors `skills_as_commands` toggle and `disabled_commands`; single-read of discovered skills (#593); honest command descriptions distinguishing discovered vs. bundled skills (#594) |
| `discovered-skills.ts`    | v2.33.0 (#592) — walks the same six roots OpenCode uses to find skills (global `~/.claude`/`~/.agents`, project `.claude`/`.agents` walked to worktree root, `.opencode` config dirs) with upstream last-write-wins precedence (`.opencode` > `.claude`/`.agents` > global); emits `/slash` commands for discovered skills; model-invocable skills get a shim loading the skill via the native skill tool with `$ARGUMENTS` passthrough, command-only skills inline the `SKILL.md` body |
| `converter.ts`            | CEP-to-OpenCode content conversion (CLI)        |
| `frontmatter.ts`          | YAML frontmatter parsing                        |
| `validation.ts`           | Agent config validation and type guards         |
| `walk-dir.ts`             | Recursive directory walker                      |

`plugin-singleton.ts` (introduced v2.7.2) has been folded into the broader factory layer — modules now coordinate via the config-handler entry point. Per-process singleton semantics are preserved.

### Bundled Assets

- **Bundled skills** in `skills/` (48 skill directories present at SHA `11b12bf`, 2026-06-19; prior surveys counted 49 — the discrepancy is methodology drift, not removal: the live directory scan counts on-disk skill folders while earlier counts folded in the project-scoped `release-notes-narrative` skill that ships outside the bundled `skills/` tree) — Core CE workflows (`ce:brainstorm`, `ce:plan`, `ce:review`, `ce:work`, `ce:compound`, `ce:compound-refresh`, `ce:ideate`), development tools (`agent-browser`, `frontend-design`, `git-worktree`, `git-commit`, `git-commit-push-pr`, `git-clean-gone-branches`), specialized skills (`dhh-rails-style`, `dspy-ruby`, `gemini-imagegen`, `proof`, `rclone`, `andrew-kane-gem-writer`), engineering practice (`test-driven-development`, `writing-skills`, `writing-systematic-skills`), autonomous workflows (`lfg`, `slfg`), release automation (`release-notes-narrative`), new in v2.28.0: `orchestrating-subagents` (#491), new in v2.30.0: `npx skills` portable install path added to docs; new in v2.31.0: `ce:compound-refresh` gains `argument-hint` frontmatter (#505). Deprecation surface marks `orchestrating-swarms` and `claude-permissions-optimizer` (#401).
- **51 agents** in `agents/` across 6 categories: `design/` (3), `docs/` (1), `document-review/` (7), `research/` (7), `review/` (28), `workflow/` (5). All 51 agents now declare explicit `temperature:` in frontmatter (v2.29.0, #495) and explicit `mode: subagent` (v2.27.0, #488). Content-integrity gates enforce both invariants in CI.
- **OCX registry** in `registry/` — Component-level installation via `ocx` CLI with named profiles (`omo`, `standalone`); v2.20.6 of the registry was the last published before the v2.21+ launch-surface refresh

### Configuration Schema

Starting in the v2.14–v2.17 arc, `systematic.json` user config is fully Zod-typed:

- `config-schema.ts` defines the canonical schema; `scripts/generate-config-schema.ts` emits a JSON Schema published at `fro.bot/systematic/schemas/v2/` (consumed by IDEs for autocomplete)
- `schema:drift` script gates the generated schema in CI
- Schema construction uses a factory pattern (#393) for composability
- Unrecognized keys and invalid values produce per-issue diagnostics surfaced in the top-level error message (#390, #398)
- Bundled skill/agent names are validated against `bundled-names.ts` for typo detection
- v2.32.0 adds a removed-names list: the JSON Schema generator folds removed names into the `disabled_skills`/`disabled_agents` enums (ships empty today, future-proofed); a content-integrity gate enforces that removed names never overlap current bundled names, preventing misclassification as a name moves active→removed (#534)
- **New top-level config property `skills_as_commands`** — first surfaced 2026-07-08 as a downstream signal via the [[fro-bot--systematic]] hosted schema (property set 7 → 8). **Confirmed source-side 2026-07-15** (SHA `4eecc77`, `config-schema.ts`): `skills_as_commands` is a `z.boolean().default(true)` toggle that registers skills discovered from user/project skill directories (OpenCode config and other agent-harness-standard locations) as slash commands. Landed in the v2.33.x arc via #592 (`feat: register discovered skills as slash commands`), refined by #593 (`disabled_commands` suppression + single-read for discovered skills) and #594 (honest command descriptions distinguishing discovered vs. bundled skills). A companion `disabled_commands: z.array(z.string()).default([])` property (array of command names to disable globally) is also present. Net top-level config properties are now eight; the earlier "source-side details unconfirmed" caveat is resolved. See [[fro-bot--systematic]] for the deployed schema snapshot and [[opencode-plugins]] for the command-registration pattern.

### CLI

The `systematic` binary provides:
- `list [type]` — List available skills, agents, or commands
- `convert <type> <file>` — Convert CEP-format files to OpenCode format
- `config show` / `config path` — Configuration inspection

### Documentation Site

Starlight/Astro docs workspace in `docs/` with content generated from bundled assets via `docs/scripts/transform-content.ts`. Deployed to `fro.bot/systematic`. Includes guides (philosophy, main loop, agent install, conversion) and generated reference pages for all skills and agents.

## Stack Divergence

Systematic diverges from the `@bfra.me/*` shared config ecosystem used by most Marcus repos:

| Aspect     | Systematic                  | Other Marcus repos (typical)         |
| ---------- | --------------------------- | ------------------------------------ |
| Linter     | Biome 2.x                  | ESLint + `@bfra.me/eslint-config`    |
| Formatter  | Biome                       | Prettier + `@bfra.me/prettier-config`|
| Runtime    | Bun                         | Node.js (pnpm)                       |
| Test       | `bun:test`                  | Vitest                               |
| Build      | `bun build` (splitting)     | tsup / Vite / native TS              |

This divergence is deliberate — the plugin targets Bun as OpenCode's native runtime and uses Biome for unified lint+format. The `package.json` still requires `node >= 18` for compatibility (e.g., the CI build verification step uses Node.js to confirm the plugin loads outside Bun).

## CI/CD

8 GitHub Actions workflows (consolidated from 9 — `fro-bot-autoheal.yaml` merged into `fro-bot.yaml` in #446; unchanged count as of 2026-06-09):

| Workflow                  | Purpose                                              | Trigger                          |
| ------------------------- | ---------------------------------------------------- | -------------------------------- |
| **Main**                  | Build, typecheck, lint, test, registry validate, docs build, release | PR, push to main, dispatch |
| **Fro Bot**               | PR review + weekly maintenance + daily autohealing in a single workflow with three operating modes routed via an inline PROMPT ternary | PR, issue, comment, discussion_comment, schedule (Mon 09:00 UTC review; daily 03:30 UTC autoheal), workflow_call, workflow_dispatch (mode: review/maintenance/autoheal) |
| **Renovate**              | Dependency updates via reusable workflow              | Issue/PR edits, push, workflow_run, dispatch |
| **CodeQL**                | Security vulnerability analysis                      | PR, push, schedule               |
| **Scorecard**             | OpenSSF supply-chain security                        | Push to main, schedule           |
| **Docs**                  | Documentation site build/deploy                      | PR, push                         |
| **Copilot Setup Steps**   | Copilot coding agent environment bootstrap           | PR                               |
| **Update Repo Settings**  | Probot settings sync                                 | Push, schedule, dispatch         |

As of v2.33.0 (#584), the `main`, `fro-bot`, and CodeQL workflows include the long-lived `v3` branch in their `pull_request.branches` filter, so `v3`-targeting PRs get the full check suite and Fro Bot review. Push triggers stay scoped to `main`, so the release job never runs against `v3` — in-progress v3 work cannot accidentally publish.

### Release Pipeline

Semantic-release with conventional commits. Notable release rules:
- `build` scope triggers patch releases (except `build(dev)`)
- `docs(skill)`, `docs(skills)`, `docs(agents)`, `docs(commands)`, `docs(readme)` trigger patch releases — skill/agent content changes are published as npm updates
- Tag format: `v${version}`
- npm publishing with provenance, GitHub Releases, GitHub App token for commits

### Branch Protection

Required status checks: Build, Docs Build, Fro Bot, Typecheck, Lint, Test, Registry, Release, CodeQL Analyze (typescript), Renovate. Linear history enforced. Admin enforcement on.

## Fro Bot Integration

**Fully active.** Consolidated into a single workflow file as of #446 (v2.23+ era):

- `fro-bot.yaml` — `fro-bot/agent@v0.90.0` (SHA `42db56dc027a5c9aee99c0ada97a406554108894`; was v0.79.4 at last survey — ~11 minor bumps via Renovate over the 2026-07-01 → 2026-07-15 interval, all `mrbro-bot[bot]`-authored churn). Three operating modes selected by an inline `PROMPT` ternary keyed on `event_name × mode × cron`:
  1. **PR review** — `PR_REVIEW_PROMPT` env, TypeScript/Bun/Biome-specific (type safety, ESM conventions, zero-class convention, breaking change detection, security implications for prompt injection)
  2. **Weekly maintenance** — `MAINTENANCE_PROMPT` env, Mon 09:00 UTC, rolling issue with 28-day window
  3. **Daily autoheal** — `AUTOHEAL_PROMPT` env, daily 03:30 UTC, 4-category sweep: errored PRs (CI fix and push), security (Dependabot/Renovate alerts), health & maintenance (major version updates, Action SHA pinning), developer experience (typecheck, lint fixes)
- `workflow_call` accepts `prompt` (required) and optional `correlation-id` — used by the `release-notes-narrative` automation to dispatch verbatim prompts and match dispatched runs by scanning early log output (#430, #432, #433, #434)
- `workflow_dispatch` accepts `mode`, `prompt`, `correlation-id`; non-empty `prompt` is honored verbatim regardless of `mode` (this precedence is mandatory for the release-notes contract — documented inline in #450)
- `@fro-bot` mention responses (OWNER/MEMBER/COLLABORATOR gated)
- Fork-PR guard for `issue_comment` events handled by an explicit API-query step because `github.event.pull_request` is null on that path (#451). Other PR-adjacent event types (`pull_request`, `pull_request_review_comment`) catch forks via the top-level `if:` gate.

### PR Review Prompt Conventions

The PR review prompt enforces:
- No `any`, no `@ts-ignore`, explicit return types on exports
- ESM: `node:` protocol for builtins, `.js` extensions on relative imports
- Functions over classes (zero-class convention)
- Biome compliance (not ESLint/Prettier)
- Breaking change awareness for plugin API hooks
- Security evaluation for system prompt injection or skill loading
- Structured verdict: `PASS | CONDITIONAL | REJECT` with blocking issues, non-blocking concerns, missing tests, risk assessment

## Renovate Configuration

Extends `marcusrbrown/renovate-config` + `sanity-io/renovate-config:semantic-commit-type`. Package rules:
- `@types/node` limited to even (LTS) major versions
- Node.js in Actions limited to LTS versions
- Semantic-release packages use `build` commit type
- `@opencode-ai/*` packages use `build` commit type
- Post-upgrade: `bun install && bun run fix`

## Notable Dependencies (as of v2.33.3 / SHA `4eecc77`)

| Package | Version | Role |
|---------|---------|------|
| `@opencode-ai/plugin` | 1.17.18 | Plugin API host (peer `^1.1.30`) |
| `@opencode-ai/sdk` | 1.17.18 | SDK tooling |
| `zod` | 4.4.3 | Config schema validation |
| `js-yaml` | ^4.1.1 | Runtime YAML parsing (direct `dependency`, externalized in `bun build`) |
| `jsonc-parser` | ^3.3.0 | JSONC config parsing (runtime dependency) |
| `ajv` / `ajv-formats` | 8.20.0 / 3.0.1 | JSON Schema validation (schema tooling, dev) |
| `@biomejs/biome` | 2.5.3 | Lint + format |
| `typescript` | 6.0.3 | Type checking |
| `bun` (`@types/bun`) | latest | Runtime |
| `@types/node` | 24.13.3 | Node compatibility types |
| `markdownlint-cli` | 0.48.0 | Markdown lint (dev) |
| `semantic-release` | 25.0.6 | Release automation |

## Probot Settings

Extends `fro-bot/.github:common-settings.yaml` — same pattern as [[marcusrbrown--ha-config]], [[marcusrbrown--vbs]], [[marcusrbrown--containers]], and other Marcus repos.

## OpenCode Configuration

`opencode.json` uses `./src/index.ts` as a local plugin (development mode). Markdownlint configured as a formatter for `.md` files.

## Relationship to Other Repos

- **[[marcusrbrown--opencode-copilot-delegate]]** — The other OpenCode plugin in Marcus's portfolio. Different purpose (Copilot CLI delegation vs. workflow orchestration) but same plugin API. Copilot-delegate uses Biome + Bun like systematic, suggesting this is the emerging standard for Marcus's OpenCode plugin repos.
- **[[marcusrbrown--dotfiles]]** — Consumes systematic as an installed plugin (`@fro.bot/systematic@latest` in OpenCode config). The dotfiles repo's OpenCode model routing and agent configuration directly uses systematic's skills and agents.
- **[[marcusrbrown--copiloting]]** — Historical CEP/AI experimentation repo. Systematic supersedes CEP for the OpenCode ecosystem.
- **[[marcusrbrown--gpt]]**, **[[marcusrbrown--vbs]]** — Repos where Fro Bot agents use systematic-provided skills and agents during PR review and maintenance.
- **`fro-bot/.github`** — This repo. Runs systematic as a plugin in the Fro Bot agent workflow. Systematic's `systematic_skill` tool is available in every Fro Bot agent session.

## Release History (since v2.5.1)

| Version | Date       | Key change                                              |
| ------- | ---------- | ------------------------------------------------------- |
| v2.6.0  | 2026-04-25 | OCX V2 schema migration, content-integrity CI gate, single-export entry point fix |
| v2.6.1  | 2026-04-28 | Import 13 missing skill reference sub-files; sub-file integrity gate |
| v2.7.0  | 2026-04-30 | Skill authoring guardrails (#325)                       |
| v2.7.1  | 2026-05-01 | Stabilize system prompt prefix (#329)                   |
| v2.7.2  | 2026-05-04 | Deduplicate factory registration across opencode.json sources (#335) |
| v2.7.3  | 2026-05-05 | Omit `model` field from all 50 bundled agents (#336, upstream fix for sst/opencode#17888) |
| v2.14–v2.17 arc | 2026-05-13 → 2026-05-20 | Typed config validation: Zod-driven `systematic.json` schema, per-issue diagnostics (#388, #390, #393, #394, #397, #398); test-driven-development + writing-skills imported from obra/superpowers (#394); schema `$ref` dedup |
| v2.18.0 | ~2026-05-21 | Skill catalog moved into system prompt (#365); deprecation surface for `orchestrating-swarms` and `claude-permissions-optimizer` (#401) |
| v2.19.0 | 2026-05-21 | SUBAGENT-STOP block + Instruction Priority section injected into `using-systematic` bootstrap (#405); v3.0.0 CC-residue excision plan committed (#403) |
| v2.20.x | 2026-05-21 | Overlay hardening: discovery before validation (#372), empty-cache to unknown status (#378), per-client memoization (#383); project-local Systematic overrides global Systematic output (#370); registry advanced to v2.20.6 with 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin) |
| v2.21.0 | 2026-05-23 | Launch-surface cleanup (#428): README, home, Quick Start, config docs, contributor docs |
| v2.22.0 | 2026-05-23 | New `release-notes-narrative` project-scoped skill (#429) |
| v2.23.0–v2.23.6 | 2026-05-23 → 2026-05-27 | Automated release-notes-narrative via `@semantic-release/exec` (#430); successCmd extraction to `scripts/dispatch-release-notes.sh` (#432); bash escape for Lodash render (#431); timestamp-based run identification replacing log-scan (#434); correlation-id input on `fro-bot.yaml` (#433); docs modernization (#421, #422); design-iterator + docs aligned with Impeccable design laws (#418, #419) |
| v2.24.0 | 2026-05-27 | OpenCode dep bumped to v1.15.10 (#442); Starlight ^0.39.0 (#444); `docs:verify` script for local CI-parity pre-checks (#445); fork-guard asymmetry documented inline (#451); PROMPT routing precedence documented inline (#450); `fro-bot.yaml` + `fro-bot-autoheal.yaml` consolidated (#446) |
| v2.25.0 | 2026-06-05 | Hompage redesign (custom hero, live stats banner, feature grid, Open Graph/JSON-LD SEO); `ce:review` Stage 5b independent finding-validation pass (#485); content-integrity check for solution-doc YAML frontmatter unquoted comments; Umami analytics wired end-to-end in CI; reproducible eval harness with transcripts and rubrics (#455); `fro-bot/agent` bumped through v0.46.0–v0.52.1 |
| v2.26.0 | 2026-06-05 | `ce:brainstorm` Phase 2.5 Synthesis Summary scope checkpoint; `ce:plan` Anti-Expansion step 3.7 + solo/brainstorm-sourced dual paths + markdown rendering layer; upstream CEP improvements merged (#486) |
| v2.27.0 | 2026-06-05 | `mode: subagent` explicit on all 51 bundled agents; `checkAgentMode` content-integrity gate; converter-equivalence test for zero-behavior-change proof; CodeQL `js/incomplete-multi-character-sanitization` alert fixed in `transform-content.ts` (#31) |
| v2.28.0 | 2026-06-05 | New `orchestrating-subagents` skill (#491): full coordination lifecycle for serial/parallel subagent work in OpenCode via `task()` dispatch |
| v2.29.0 | 2026-06-07 | Explicit `temperature:` on all 51 bundled agents; `checkAgentTemperature` content-integrity gate; `fro-bot/agent` v0.55.1–v0.55.3 (#492–494) |
| v2.30.0–v2.30.1 | 2026-06-07 | `npx skills add marcusrbrown/systematic` as portable harness-agnostic install path; every non-deprecated skill reference page gets a copyable `npx skills add` command; MDX footguns documented (JSX `<name>` placeholder trap, copy-button on fenced blocks only); docs generator covered by 9 unit tests |
| v2.31.0 | 2026-06-07 | `ce:compound-refresh` gains `argument-hint` frontmatter (#505); `argument-hint` enforcement column in `writing-systematic-skills`; guard fails any skill referencing `$ARGUMENTS` outside fenced code blocks without `argument-hint`; release dispatch confirmation timeout now `::warning::` + exit 0 (#504); `fro-bot/agent` v0.55.6 (3 security hardening fixes: IPv6 egress bypass, DNS resolution timeout, compose topology guard) |
| v2.32.0 | 2026-06-15 | Removed-names lifecycle for `disabled_skills`/`disabled_agents` (#534): schema-enum acceptance + validation acceptance + load-time silent drop with per-load `[systematic]` warning; content-integrity gate enforces removed-names ∩ bundled-names = ∅; `biome.json` `$schema` synced to 2.4.16 (#533, fixes CLI deserialize/lint failure); OpenCode dep arc v1.16.2→v1.17.7; `orchestrating-subagents` corrected for OpenCode 1.17.6 + now recommends background subagents (#530); `fro-bot/agent` v0.59.1→v0.71.0; semantic-release v25.0.5 |
| v2.32.1 | 2026-06-26 | Pure maintenance release — no source/skill/agent changes. Pre-fixes two Biome 2.5.0 error-level rules ahead of the `@biomejs/biome` bump (#538): `noSvgWithoutTitle` on `docs/public/favicon.svg` (added `<title>` + `role="img"`/`aria-labelledby`) and `noImportantStyles` on `docs/src/styles/custom.css` (replaced three `!important` decls with higher-specificity `.install-header .install-title` selector, no visual change). Also folds OpenCode v1.17.4→v1.17.9 (#536, #541, #542, #544, #552, #557), `fro-bot/agent` v0.64.2→v0.78.0 (14 Renovate bumps #535–#561), Playwright v1.61.0 (#547) |
| v2.32.2 | 2026-07-04 | Maintenance patch: security bump of Pillow minimum version to patch known CVEs (#576); OpenCode v1.17.9→v1.17.13; `fro-bot/agent` v0.79.0→v0.81.0; `bfra-me/.github` v4.16.32→v4.16.33 |
| v2.33.0 | 2026-07-07 | **Feature: discovered skills as slash commands** (#592, `src/lib/discovered-skills.ts`). Skills discovered from user/project locations can now surface as `/slash` commands, not only model-invocable tools. New discovery pass walks the same six roots OpenCode uses with its own last-write-wins precedence. Gated behind new `skills_as_commands` config toggle (default true). Model-invocable skills get a shim loading via native skill tool with `$ARGUMENTS` passthrough; command-only skills inline the `SKILL.md` body. Each generated command carries a `(Systematic - Skill)` marker for idempotent re-runs. Also: `v3` long-lived branch added to `pull_request.branches` filter across main/fro-bot/CodeQL workflows (push stays main-scoped so release never runs on `v3`, #584); complexity refactor split `validateFieldExamples` (CC 41) and `extractFrontmatter` (CC 25) into helpers, repo complexity warnings 6→4 (#582); plan-status housekeeping (#583, #591) |
| v2.33.1 | 2026-07-07 | Follow-up to #592: `disabled_commands` now actually suppresses discovered-skill commands (filters emission by the free-form `disabled_commands` field, leaving the stricter `disabled_skills` bundled-name enum untouched); closes a CodeQL `js/file-system-race` TOCTOU (dropped `statSync` pre-check, read file directly relying on existing `EISDIR`/`ENOENT` catch); single-read fix — `extractFrontmatterFromContent` split out so command-only discovered skills read `SKILL.md` once instead of twice (#593) |
| v2.33.2 | 2026-07-07 | Labelling honesty for skills-as-commands (#594): discovered skills lose the `(Systematic - Skill)` prefix entirely (it falsely implied Systematic authorship) and surface the skill's own description as-is; bundled skills-as-commands drop the `- Skill` qualifier to read simply `(Systematic)`, matching bundled plain commands. `isSystematicCommandConfig` recognizes only `(Systematic)` going forward — no migration needed since OpenCode applies config-hook mutations in memory per load and never persists them |
| v2.33.3 | 2026-07-14 | Maintenance patch: security bump of Pillow minimum version to patch known CVEs (#620, closes #28); OpenCode v1.17.14→v1.17.18; `semantic-release` v25.0.6 (#619); `fro-bot/agent` v0.84.0→v0.88.0; `bfra-me/.github` v4.16.35→v4.16.36; CodeQL action v4.37.0 |

### Downstream-observed release activity (2026-09-04) — not a source-side survey

Gathered incidentally while surveying the deploy target [[fro-bot--systematic]]; recorded here because this page's release history stops at v2.33.3 (2026-07-14) and is now ~7 weeks stale. **A direct source-side survey remains warranted** — the v3 architecture change has still never been examined from the source, and nothing below inspects the tree.

> **2026-09-05 disposition.** The warranted survey has been done (see above). Three claims in this block are corrected by it: (a) the v3 boundary is **`3.0.0` on 2026-07-17**, not `v3.2.5`/2026-07-22 — the latter was the first version the deploy target exposed; (b) the 10-day drought **ended 2026-09-04T17:52Z** with `3.15.1`, followed by `3.16.0` and `3.16.1` on 2026-09-05, confirming the "compositional, not a fault" diagnosis rather than undermining it; (c) the catalog is no longer flat — `v3.16.0` added the `profile`/`profiles` config surface and the deployed schema grew 54% in bytes within 24 hours of being fingerprinted. The `workflow` category note stands: it is a real agent directory (4 agents) and remains absent from the schema's `categories` enumeration, which is still open-keyed. Everything else in this block held up on direct inspection.

- **npm `dist-tags.latest` = `3.15.0`**, published 2026-08-25T07:59:53Z. 204 published versions total. The v3 line has run `3.2.5` (2026-07-22) → `3.15.0` in ~5 weeks.
- **Release cadence is burst-and-drought, not steady.** 31 publishes landed 2026-08-13 → 2026-08-25 (including 15 in the final 49.5 hours), bracketed by a 9.2-day drought (2026-08-04 → 08-13) and the current **10-day drought** (2026-08-25 → 2026-09-04, npm packument `modified` = the 3.15.0 publish timestamp).
- **The drought is compositional, not a fault.** `main` HEAD is `4cea0620` (2026-09-03T01:17:27Z). The 16 commits after the last released commit (`c5273ee8`) are one `docs(solutions):` and fifteen `chore(deps)`/`chore(dev)` Renovate automerges — no releasable conventional-commit type, so semantic-release correctly published nothing. Repo `pushed_at` reads 2026-09-04 (open PR branches).
- **`fro-bot/agent` pin moved v0.105.1 → v0.107.1** across six bumps in nine days (#882, #884, #886, #887, #889, #892) — the fastest-moving dependency in the interval and consistent with the ecosystem-wide agent version train.
- **Catalog flat at 73 components** (37 agents / 31 skills / 2 bundles / 2 profiles / 1 plugin) since the v3 boundary — six weeks with no agent or skill added or removed, the longest flat stretch on record. The prior page text describing **51 agents / 48 skill dirs** is v2-era and superseded by the v3 contraction; treat those figures as historical.
- **A `workflow` agent category exists as of 3.15.0** ([[marcusrbrown--dotfiles]], 2026-08-26) but does **not** appear in the published config schema, which models `categories` as an open-keyed record rather than an enum. See [[fro-bot--systematic]] and [[opencode-plugins]] for why that asymmetry matters to users.
- Open issues 10, stars 24 (up from 23 at the 2026-07-15 survey).

## Open Issues / PRs

### 2026-09-05 — 10 open items (8 issues, 2 PRs)

The queue changed character completely. v2 ran with three rolling automation issues and zero PRs; v3 carries **six substantive, human-authored engineering issues filed by `marcusrbrown` against his own new subsystems**. Every one is a precise self-critique, and together they are the best available map of where v3 is unfinished:

| # | Opened | Title | Reading |
| --- | --- | --- | --- |
| #897 | 2026-09-04 | Typecheck never covers `tests/` or `scripts/` | **Confirmed from `tsconfig.json`** — see above. ~400 KB of unchecked TS including the content-integrity gate. |
| #854 | 2026-08-24 | The workflow guard is OpenCode-only because of its state model, not because other harnesses can[not] | The sharpest qualifier on the tri-harness claim. The largest subsystem is single-harness by internal design, not external limit. |
| #834 | 2026-08-22 | `validate-review-artifact` cannot check an artifact outside the run directory | Path-scoping limit in the review-artifact validator. |
| #796 | 2026-08-17 | `ce:review` artifacts retain verbatim private source indefinitely with no retention policy | Privacy defect in the review pipeline — verbatim source, no expiry. Pairs with `tests/unit/eval-redaction.test.ts`. |
| #795 | 2026-08-17 | `ce:review`'s deterministic merge pipeline is prose, not code | The merge/dedup stage users are told is deterministic is a prompt instruction, not an implementation. |
| #740 | 2026-08-03 | Harden receipt guard: marker v1 read shim + observer worktree-registry refresh | Receipt/guard hardening. |
| #153 | 2026-03-09 | Daily Autohealing Report | Rolling. 49,145 chars, 1 dated section, 158 comments. |
| #15 | 2026-01-26 | Dependency Dashboard | Renovate. |

Open PRs: **#906** (`docs(guide): add the model profiles and per-harness routing guide`, `marcusrbrown`, opened today — documentation trailing the v3.16.0 feature by hours) and **#880** (`build(dev): update OpenCode to v1.18.26`, `mrbro-bot[bot]`, open since 2026-08-27 — 9 days, in a repo where Renovate PRs otherwise land same-day; its `build(dev)` scope is explicitly `release: false` in `.releaserc.yaml`, so it cannot ship a version on its own).

#796 deserves particular note against Marcus's stated principles: a review pipeline that retains verbatim private source with no retention policy is the privacy-baseline violation this ecosystem otherwise designs hard against. It is filed and open, not hidden.

### 2026-07-15 (v2.33.3) — historical

| # | Title | Type |
|---|-------|------|
| #157 | Weekly Maintenance Report | Issue (rolling) |
| #153 | Daily Autohealing Report | Issue (rolling) |
| #15  | Dependency Dashboard | Issue (Renovate) |

0 open PRs at that survey — main was fully drained. #157 has since been closed by the report-migration clause that retired `maintenance` mode. Open-issue set unchanged across the last several surveys (the three rolling automation issues only). (Latest HEAD: `4eecc77` — `chore(deps): update fro-bot/agent to v0.90.0` (#625), 2026-07-15. Recent merges co-authored by `mrbro-bot[bot]`; the two substantive human-authored PRs this interval — #582 complexity refactor and #592–#594 skills-as-commands — are by `marcusrbrown`, security bumps #576/#620 by `fro-bot`.)

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-04-24 | `ef02119`  | Initial survey           |
| 2026-05-06 | `420ef65`  | 28 commits, v2.5.1→v2.7.3, skills 45→46, agent v0.41.4→v0.42.7, `plugin-singleton.ts` added, OCX V2, content-integrity gate, skill guardrails, model field removal |
| 2026-05-28 | `9b75707`  | ~80 commits, v2.7.3→v2.24.0, skills 46→47, agents 50→51, agent v0.42.7→v0.45.0, `fro-bot.yaml` + `fro-bot-autoheal.yaml` consolidated (#446), `plugin-singleton.ts` removed, Zod config schema arc (v2.14–v2.17), `release-notes-narrative` skill + semantic-release-driven dispatch, launch-surface cleanup, docs modernization, deprecation surface, overlay hardening, project-local override fix |
| 2026-06-09 | `4d2c123`  | ~86 commits since last survey, v2.24.0→v2.31.0, skills 47→49 (+`orchestrating-subagents` v2.28.0), agent v0.45.0→v0.59.0; explicit `mode: subagent` on all 51 agents (#488); explicit `temperature:` on all 51 agents (#495); content-integrity gates for both; `ce:brainstorm` Phase 2.5 + `ce:plan` Anti-Expansion; `ce:review` Stage 5b validation; homepage redesign with live stats; `npx skills` portable install path (v2.30.0); `argument-hint` enforcement (v2.31.0); release dispatch timeout now non-fatal; OpenCode dep at v1.16.2 |
| 2026-06-19 | `11b12bf`  | 32 commits since last survey (mostly Renovate churn), v2.31.0→v2.32.0, agent v0.59.0→v0.71.0 (12 minor bumps), OpenCode v1.16.2→v1.17.7, semantic-release v25.0.3→v25.0.5. Feature: removed-names lifecycle for disable lists + content-integrity gate (#534, v2.32.0). Fix: `orchestrating-subagents` corrected for OpenCode 1.17.6, recommends background subagents (#530); `biome.json` `$schema` synced to 2.4.16 (#533). 8 workflows + 51 agents unchanged; bundled skill dir count 48 (methodology note added — no removals). New runtime deps surfaced in manifest: `js-yaml`, `jsonc-parser` |
| 2026-07-01 | `c2c43fd`  | **Pure-maintenance interval** — 23 commits since last survey, all Renovate/dep churn (22 `mrbro-bot[bot]`-authored bumps + 1 lint sync). v2.32.0→v2.32.1 (2026-06-26, no source/skill/agent changes; Biome 2.5.0 pre-fix for `noSvgWithoutTitle` + `noImportantStyles` in docs). agent v0.71.0→**v0.79.4** (8 minors), OpenCode v1.17.7→v1.17.11, Biome 2.4.16→**2.5.1** (`biome.json` `$schema` synced, #571), `bfra-me/.github` reusable workflows→v4.16.32 (#567), Playwright→v1.61.1. Structure unchanged: 8 workflows, 51 agents (3/1/7/7/28/5), 48 bundled skill dirs, MIT, `node >=18` compat floor holds. Confirmed pre-existing top-level `.slim/` (`clonedeps.json`) and `.opencode/` (`themes/`, `tui.json`, `package-lock.json`) dev-config dirs — present at prior SHA, not new. Stars 22→23, open issues unchanged (3 rolling) |
| 2026-09-05 | `9bceff39` | **First direct source-side survey of v3 — the standing "warranted" note is discharged.** 245 commits since `4eecc77`; authorship inverts the fleet (`mrbro-bot[bot]` 129 / **`marcusrbrown` 112** / `fro-bot` 4). **v3.0.0 landed 2026-07-17**, two days after the last survey — the previously recorded `v3.2.5`/2026-07-22 boundary was a downstream artifact and is **superseded**. Latest **v3.16.1** (2026-09-05T08:39Z, cut from this HEAD). **Architecture: one content source, three shipped harness adapters** (OpenCode / Pi / Claude Code) with **all three peer deps optional**, a `"pi"` manifest key, dual-target build, and `HARNESSES.md` — a 6-harness × 5-capability, two-tier matrix with a citation-key evidence registry and literal **`UNVERIFIED`** cells. **New dominant subsystem: workflow guard + receipts** (`opencode-workflow-guard.ts` 130 KB, `workflow-guard.ts` 117 KB, `receipt-{readback,ledger,classifier}`, `question-attestation`, `capability-snapshot`), with **`tree-sitter-bash` + `web-tree-sitter` now runtime deps** — the plugin ships a WASM grammar to parse shell. Guard confirmed live in-ecosystem at `mode: observe`. Catalog **51 → 37 agents** (categories 6 → 5, `docs/` eliminated, `review/` 28 → 18) and **48 → 31 skills**; the long-standing 48-vs-49 methodology caveat is **closed** (`release-notes-narrative` now literally lives in `.agents/skills/`). Deployed config schema **38,180 B / 74 defs / 10 props → 58,954 B / 100 defs / 12 props** in <24 h (`sha256[:16]` `0e82797b…` → **`1f9b7c48a4b6455c`**), new `profile`/`profiles` from v3.16.0, with a **schema-encoded trust boundary** (a project config may select a profile but may not define one); the sibling page's structural probes broke on an `allOf`/`$ref` refactor while its fingerprint survived. `fro-bot.yaml` 711 lines, agent **v0.108.1** (ecosystem leader), `checkout` v7.0.1: modes **3 → 2**, crons **2 → 1**, autoheal categories **4 → 10**, weekly work demoted to a **`IS_SUNDAY_UTC`-gated category** rather than a second cron; new marker-anchored **issue-triage mode**. **Headline finding: the perpetual-report retention policy is arithmetically unsatisfiable** — 50,000-char cap vs "30 most recent sections" at a ~31,000-char floor yields 1, self-recorded by the bot (peak 139,930 chars), destroying the history categories 5 and 8 depend on. Daemon healthy (4,100 runs, 15/15 scheduled green, all 8 workflows `active`). Confirmed **#897**: `tsconfig` includes only `src/**/*`, leaving ~400 KB of TS — incl. the content-integrity gate — outside a required `Typecheck` check. `Publish Claude Code Plugin` feeds an advertised install path but is not and cannot be a required check. Orphan **`v2.33.4`** published after `v3.12.0` with no `v2` dist-tag and no surviving branch. TS 6 → 7, `@types/node` 24 → 26, Biome 2.5.3 → 2.5.11 (`$schema` still 2.5.1 — third drift). Stars 23 → 24; open items 3 → **10**, six of them human-authored self-critiques |
| 2026-07-15 | `4eecc77`  | **First feature interval since v2.31.0** — 42 commits since last survey. v2.32.1→**v2.33.3**. Headline: **discovered skills as slash commands** (#592, v2.33.0) — new `src/lib/discovered-skills.ts` walks the six OpenCode skill roots with upstream last-write-wins precedence and registers discovered skills as `/slash` commands, gated by new `skills_as_commands` config toggle (default true); refined by #593 (`disabled_commands` suppression + single-read + CodeQL TOCTOU fix) and #594 (labelling honesty — drop `(Systematic - Skill)` prefix). **This confirms the source semantics of the `skills_as_commands` property first surfaced downstream at the 2026-07-08 [[fro-bot--systematic]] schema survey** — caveat resolved. New config property `disabled_commands` also present. `v3` long-lived branch added to CI `pull_request.branches` filter (#584; push stays main-scoped, release never runs on `v3`). Complexity refactor (#582, warnings 6→4). Two security patches bumping Pillow minimum (#576 v2.32.2, #620 v2.33.3). agent v0.79.4→**v0.90.0** (~11 minors), OpenCode v1.17.11→v1.17.18, Biome 2.5.1→2.5.3, semantic-release v25.0.5→v25.0.6, `bfra-me/.github`→v4.16.36. Structure otherwise unchanged: 8 workflows, 51 agents (3/1/7/7/28/5), 48 bundled skill dirs, MIT, `node >=18` floor. Stars steady at 23, open issues unchanged (3 rolling), 0 open PRs |
