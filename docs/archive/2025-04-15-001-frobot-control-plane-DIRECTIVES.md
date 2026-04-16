# Plan Rewrite Directives — Fro Bot Control Plane

This document captures all review findings (Metis + Oracle + document-review personas) and user decisions that must be applied when rewriting `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md`.

**Use this as the single source of truth for the rewrite.**

---

## User Decisions (Locked)

### Design Decisions

| Decision | Choice |
|----------|--------|
| **Renovate dispatch** | Keep autonomous. **Revise R17** to classify Renovate dispatch as autonomous (it triggers an existing workflow in the target repo, not writing code). |
| **Wiki ingest granularity** | **Hybrid**: survey on invite acceptance + per-event incremental ingest (PR reviews, issue interactions, scheduled oversight) + weekly lint pass. This is the Karpathy compounding pattern. |
| **Data branch merge strategy** | **Conditional auto-merge**: weekly workflow opens `data` → `main` PR. Auto-merge if only `knowledge/` and `metadata/` paths changed. Human approval required if any other paths changed (defense-in-depth). |
| **Social broadcast curation** | **Hybrid**: static allowlist + cooldowns decide WHEN to broadcast (deterministic gates). Agent generates WHAT is posted (persona voice, platform-appropriate content). Separates decision from content. |

### Convention Decisions

| Convention | Choice |
|----------|--------|
| **Script directory** | `scripts/` at repo root. Single location for all TypeScript scripts. No `.github/scripts/`. |
| **PAT naming** | `FRO_BOT_POLL_PAT` (scopes: `repo:invite`, `read:org`, `public_repo`). Used everywhere the plan currently says `FRO_BOT_READ_PAT`. Write PAT remains `FRO_BOT_PAT`. |
| **YAML dependency** | Add `yaml@^2.x` to `package.json` dependencies. Required for TypeScript scripts to parse/write metadata files. |
| **Script execution** | `node scripts/foo.ts` — Node v24 native TypeScript support (no `--experimental-strip-types` flag needed, no `tsx`/`ts-node`). |
| **Wiki directory structure** | Flat files + category subdirs: `knowledge/wiki/repos/`, `knowledge/wiki/topics/`, `knowledge/wiki/entities/`, `knowledge/wiki/comparisons/`. Plus `knowledge/index.md`, `knowledge/log.md`, `knowledge/schema.md` at `knowledge/` root. |
| **GitHub API access** | Use `@octokit/rest` or `@octokit/core` typed SDK, NOT raw `fetch()` for GitHub API calls. Avoid `gh` CLI shell-outs in TypeScript scripts. |

---

## P0 Blockers — Must Fix

### P0-1: Unit 7/Unit 10 Heading Swap
**Current state**: Unit 7 is titled "Discord Notification Script" but body describes Renovate dispatch. Unit 10 is titled "Renovate Smart Dispatch" but body describes Discord webhook. Headings are wrong.
**Fix**: Swap heading text between Unit 7 and Unit 10. Keep body content. After renumbering (see P1-9), the phase alignment will be correct.

### P0-2: All Shell Scripts → TypeScript
**Current state**: Plan references 8+ `.sh` files. Approach sections describe "shell functions", "curl", "bash scripts".
**Fix**: Every `.sh` reference becomes `.ts`. Every `curl` call becomes `fetch()` or Octokit. Every "shell function" becomes "TypeScript module with typed exports". Every `gh` CLI shell-out becomes Octokit API call.

**Script inventory (all under `scripts/`):**
- `scripts/commit-metadata.ts` — importable module with typed exports for shared retry-with-refetch (exports: `commitMetadata(path, mutator, options)`)
- `scripts/handle-invitation.ts` — invitation handling
- `scripts/survey-repo.ts` — repo survey (if one is needed vs inline workflow)
- `scripts/journal-entry.ts` — journal system
- `scripts/discord-notify.ts` — Discord webhook posting (fetch-based, was `discord-notify.sh`)
- `scripts/dispatch-renovate.ts` — Renovate dispatch (was `dispatch-renovate.sh`)
- `scripts/update-metadata.ts` — metadata scanner (was `update-metadata.sh`)
- `scripts/wiki-ingest.ts` — Karpathy wiki ingest operation (NEW — see P1-2)
- `scripts/wiki-query.ts` — Karpathy wiki query operation (NEW — see P1-2)
- `scripts/wiki-lint.ts` — Karpathy wiki lint operation (NEW — see P1-2)
- `scripts/data-branch-bootstrap.ts` — create/init data branch (NEW — see P1-1)
- `scripts/merge-data-pr.ts` — weekly data → main merge PR creation (NEW — see P1-1)
- `scripts/bluesky-post.ts` — already TypeScript (Unit 11)

**Note on Key Technical Decisions section:**
- Line ~65 "Discord via curl, BlueSky via Node script" → "Discord and BlueSky via TypeScript scripts under `scripts/`, using `fetch()` / `@atproto/api` respectively"
- Line ~71 `scripts/commit-metadata.sh` → `scripts/commit-metadata.ts`

### P0-3: Knowledge Base Architecture — Full Rewrite to Karpathy Pattern

**Current state**: Plan treats knowledge as per-repo `index.md` files that get overwritten on re-survey. Kills compounding. Has no operations beyond initial seeding.

**Required architecture** (directly from Karpathy's gist):

**Three layers:**
1. **Raw sources** — Target repo content, referenced by SHA/URL in wiki pages. Immutable (we don't modify upstream repos). Never copied into our repo.
2. **The wiki** — LLM-generated, persistent, compounding markdown under `knowledge/wiki/`. Cross-references entities, topics, concepts across ALL repos. The LLM owns this layer entirely.
3. **The schema** — `knowledge/schema.md` — conventions document (page types, frontmatter, cross-ref rules). The "AGENTS.md equivalent" per Karpathy.

**Three operations** (each is a first-class workflow or TypeScript module):
- **Ingest** — When a new source arrives (repo survey, PR review completion, issue interaction, scheduled oversight), the agent:
  - Reads the source
  - Identifies which wiki pages need updating (entity pages, topic pages, comparisons)
  - Creates new pages when new entities/concepts appear
  - Updates existing pages with new information (contradictions noted)
  - Updates `knowledge/index.md` with any new pages
  - Appends an entry to `knowledge/log.md`
  - Commits all changes atomically to `data` branch
- **Query** — Pre-agent-dispatch step in `fro-bot.yaml`:
  - Search wiki for relevant pages given task context
  - Synthesize knowledge excerpts for agent prompt injection
  - If the synthesis produces valuable new insight, file it back as a wiki page
- **Lint** — Weekly scheduled workflow (Sunday 20:00 UTC, matching `fro-bot/agent` WIKI_PROMPT pattern):
  - Contradictions between pages
  - Stale claims (source SHA older than N weeks)
  - Orphan pages (no inbound wikilinks)
  - Missing cross-references
  - Knowledge gaps (concept mentioned but no page)
  - Opens PR on `fro-bot/wiki-lint` branch with fixes
  - Writes lint results to `knowledge/log.md`

**Two special files:**
- `knowledge/index.md` — master catalog of ALL wiki pages across ALL repos, organized by category (Repos, Topics, Entities, Comparisons)
- `knowledge/log.md` — chronological append-only record: `## [YYYY-MM-DD HH:MM] <operation> | <target>` prefix for grep-ability

**Wiki structure:**
```
knowledge/
├── index.md           # Master catalog
├── log.md             # Chronological log
├── schema.md          # Conventions (page types, frontmatter, cross-refs)
└── wiki/
    ├── repos/         # Entity page per repo — full page, NOT just index.md
    │   ├── fro-bot.md
    │   └── my-other-repo.md
    ├── topics/        # Cross-repo concept pages
    │   ├── ci-patterns.md
    │   └── testing-strategies.md
    ├── entities/      # Technologies, tools, people
    │   ├── typescript.md
    │   └── github-actions.md
    └── comparisons/   # Cross-repo synthesis
        └── renovate-configs-compared.md
```

**Frontmatter schema** (extend existing `fro-bot/agent/docs/wiki/` format):
```yaml
---
type: repo | topic | entity | comparison | source-summary
last-updated: YYYY-MM-DD
updated-by: <commit-sha>
sources:
  - url: https://github.com/owner/repo
    sha: <commit-sha>
    paths: [README.md, package.json]
summary: One-line summary
---
```

**Cross-references**: Obsidian wikilinks `[[Page Name]]` (matches existing agent wiki).

**CRITICAL: Remove "Survey is idempotent — re-running overwrites the knowledge entry"** (Unit 5 approach). Replace with:
> Re-surveys are INCREMENTAL. Read existing wiki pages for the repo. Compare with fresh findings. Update with new information, preserve accumulated knowledge. Note what changed and when in `log.md`.

### P0-4: Add `yaml` Dependency
**Current state**: Plan has TypeScript scripts that need to parse/write YAML, but no YAML parser dependency exists.
**Fix**: Add to `package.json`:
```json
"dependencies": {
  "yaml": "^2.6.0",
  "@atproto/api": "^0.x"  // already planned in Unit 11
}
```
Mention this addition in Unit 2's files list.

### P0-5: Unit 8 Commit Strategy — Git-Based Atomic (NOT Contents API)
**Current state**: Unit 8 and commit-metadata pattern use GitHub Contents API with per-file SHA-retry. Wiki ingest updates 10-15 files atomically — per-file API risks torn state.
**Fix**: For **multi-file** commits (wiki ingest especially), use git-based atomic commits:
1. Checkout `data` branch in workflow runner
2. Apply all file changes locally
3. Commit with descriptive message
4. Push with `--force-with-lease` (or rebase on 409)
5. Retry on push conflict by re-fetching and replaying

For **single-file** metadata updates (repos.yaml, allowlist.yaml, social-cooldowns.yaml), Contents API + SHA retry is still fine.

Document this split in Key Technical Decisions:
> **Commit strategy differs by scope**: Single metadata file updates use GitHub Contents API with retry-with-refetch (simpler, atomic at file level). Multi-file wiki ingest uses git-based atomic commits to `data` branch (ensures no torn state across entities/topics/log/index).

### P0-6: Auto-Merge Rule — Conditional on Paths
**Current state**: Line ~70 says "auto-merge if only knowledge/ and metadata/ paths changed". Good but needs formalization.
**Fix**: Implement as explicit rule in data branch merge unit (see P1-1):
- Weekly workflow opens `data` → `main` PR
- Workflow checks `git diff --name-only origin/main...HEAD`
- If ALL changed paths start with `knowledge/` or `metadata/`: label `auto-merge`, enable auto-merge via `gh pr merge --auto`
- If ANY path is outside those directories: label `needs-review`, post notification to journal for human attention

---

## P1 Missing Units — Must Add

### P1-1: New Unit — Data Branch Lifecycle
**Position**: Insert after Unit 3.5 (Secrets Hardening), before current Unit 4 (Invitation Polling).
**Content:**
```markdown
- [ ] **Unit 4: Data Branch Lifecycle**

**Goal:** Create and maintain the `data` branch used for autonomous writes. Set up weekly merge workflow.

**Requirements:** R9, R16 (autonomous state persistence)

**Dependencies:** None (infrastructure)

**Files:**
- Create: `scripts/data-branch-bootstrap.ts` — creates `data` branch from `main` if missing
- Create: `scripts/merge-data-pr.ts` — opens weekly `data` → `main` PR with auto-merge logic
- Create: `.github/workflows/merge-data.yaml` — scheduled weekly, triggers merge script
- Modify: `.github/settings.yml` — add `data` branch (no branch protection)

**Approach:**
- `data-branch-bootstrap.ts`: Check if `data` branch exists. If not, create from `main`. Idempotent.
- Weekly workflow (Sundays 22:00 UTC, after wiki lint at 20:00): opens PR from `data` → `main`
- `merge-data-pr.ts` checks diff paths:
  - If all changes under `knowledge/` or `metadata/`: label `auto-merge`, enable auto-merge
  - If any paths outside those: label `needs-review`, journal entry created
- Conflict handling: if merge fails, journal entry with conflict details for manual resolution
- Stale divergence alert: if `data` is >2 weeks ahead of `main` without successful merge, create journal issue

**Patterns to follow:**
- `bfra-me/.github` auto-release pattern for scheduled workflow with merge PR creation

**Test scenarios:**
- First run creates `data` branch
- Weekly merge PR auto-merges when only knowledge/metadata changed
- Weekly merge PR requires review when code paths changed
- Conflict triggers journal entry
- Stale divergence (>2 weeks) triggers alert

**Verification:**
- `data` branch exists
- Weekly merge PRs are created
- Auto-merge succeeds for knowledge-only changes
- Human review enforced for code changes
```

### P1-2: Three Wiki Operation Units (Replacing Unit 5 single "Survey" Unit)

Replace current Unit 5 (Repo Survey & Knowledge Base Seeding) with three distinct units that implement the Karpathy operations. The wiki schema document is part of the first unit.

**Unit 6: Wiki Schema & Initial Structure**
```markdown
**Goal:** Define the wiki conventions and initialize the knowledge base structure.

**Requirements:** R9, R10, R11

**Dependencies:** Unit 4 (data branch)

**Files:**
- Create: `knowledge/schema.md` — wiki conventions (page types, frontmatter, cross-ref rules)
- Create: `knowledge/index.md` — master catalog (initially empty but structured)
- Create: `knowledge/log.md` — chronological log (initially with bootstrap entry)
- Create: `knowledge/wiki/README.md` — brief explanation of structure
- Create empty category dirs: `knowledge/wiki/repos/.gitkeep`, `knowledge/wiki/topics/.gitkeep`, `knowledge/wiki/entities/.gitkeep`, `knowledge/wiki/comparisons/.gitkeep`

**Approach:**
- `schema.md` defines: page type taxonomy (repo/topic/entity/comparison/source-summary), required vs optional frontmatter fields, wikilink convention, naming (kebab-case for filenames), when to create new page vs update existing, max page size guidance (2KB soft, 5KB hard)
- `index.md` organized by category with sections for Repos, Topics, Entities, Comparisons
- `log.md` uses prefix `## [YYYY-MM-DD HH:MM] <op> | <target>` for grep-ability

**Verification:**
- Schema document exists and is comprehensive
- Directory structure matches intended architecture
- Index and log files exist with valid initial content
```

**Unit 7: Repo Survey + Wiki Ingest**
```markdown
**Goal:** After accepting an invitation, Fro Bot surveys the repo and INGESTS findings into the wiki (creating/updating 5-15 pages across repos/topics/entities/comparisons).

**Requirements:** R5, R10, R11, R16

**Dependencies:** Unit 1 (persona), Unit 5 (previous Unit 4, invitation handling), Unit 6 (wiki schema)

**Files:**
- Create: `.github/workflows/survey-repo.yaml`
- Create: `scripts/wiki-ingest.ts` — reusable ingest logic (used by survey AND event ingest in Unit 13)
- Dynamically creates/updates: `knowledge/wiki/repos/{repo-slug}.md`, plus relevant `topics/`, `entities/`, `comparisons/` pages

**Approach:**
- Triggered by `workflow_dispatch` from invitation handler (passes repo owner/name)
- Uses `FRO_BOT_POLL_PAT` for target repo read (untrusted content)
- Content ingestion is capped: directory listings, README, manifest files (package.json/Cargo.toml/etc.), workflow files. No arbitrary file reads
- Uses `fro-bot/agent` action with persona + INGEST_PROMPT
- INGEST_PROMPT instructs agent to:
  1. Read existing wiki state (`knowledge/index.md`, relevant pages)
  2. Analyze the new source
  3. Decide which pages to create/update: a repo page always, topic pages for notable patterns observed, entity pages for unfamiliar technologies, comparisons where relevant
  4. Produce a multi-file patch — one commit affecting 5-15 files
  5. Update `knowledge/index.md` to catalog new/updated pages
  6. Append entry to `knowledge/log.md`: `## [YYYY-MM-DD HH:MM] ingest | repo:{owner}/{name}`
- Output validation: frontmatter matches schema, no workflow syntax/shell injection, total patch size <50KB
- Re-survey is INCREMENTAL: agent reads existing pages first, preserves accumulated knowledge, notes what changed
- Uses git-based atomic commit to `data` branch (NOT Contents API per-file)
- If no `fro-bot.yaml` workflow exists in target repo, proposes one via draft PR (approval-required, uses `FRO_BOT_PAT`)

**Test scenarios:**
- Survey produces 5+ wiki pages for a real repo
- Re-survey updates without overwriting (compounding)
- Cross-repo pages (topics/entities) get updated across multiple surveys
- Draft PR for fro-bot.yaml only created when workflow doesn't exist
- Ingest output validated before commit
- Atomic commit — no partial wiki state

**Verification:**
- Multiple wiki files created/updated in one ingest
- `index.md` references new pages
- `log.md` has ingest entry
- Draft PR (if created) has persona-consistent description
```

**Unit 13: Wiki Query Integration + Event Ingest**
```markdown
**Goal:** (a) Agent calls are augmented with wiki context via query step. (b) Significant events (PR review, issue interaction, oversight) trigger incremental wiki ingest.

**Requirements:** R6, R10, R11

**Dependencies:** Unit 1 (persona), Unit 6 (wiki schema), Unit 7 (ingest script), Unit 8 (current Unit 6, enhanced event handling with persona)

**Files:**
- Create: `scripts/wiki-query.ts` — search wiki for relevant pages given context
- Modify: `.github/workflows/fro-bot.yaml` — add wiki-query pre-step and wiki-ingest post-step

**Approach:**
- Pre-agent-dispatch: `wiki-query.ts` receives task context (event type, repo, PR/issue title/body), searches `knowledge/index.md` + relevant pages, produces relevant-knowledge excerpt for prompt injection
- Query budget: max 5KB injected knowledge, prioritize by page `type` matching event (repo page for repo events, topic pages for cross-cutting events)
- Post-agent-dispatch: if agent output produced insight worth persisting (agent flags via structured marker `<!-- wiki-insight: ... -->`), trigger wiki-ingest as post-step
- Ingest on: PR review completion, issue resolution, scheduled oversight (weekly summary)
- Uses git-based atomic commit to `data` branch

**Test scenarios:**
- Query returns relevant pages for a PR review task
- Agent prompt includes wiki excerpts within token budget
- Event ingest creates/updates wiki pages for significant interactions
- Wiki grows incrementally across interactions (not just from surveys)

**Verification:**
- Wiki pages grow from non-survey interactions (R11 satisfied)
- Agent responses reference wiki knowledge visibly
- Query budget never exceeded
```

### P1-3: New Unit — Wiki Lint (Weekly)
**Position**: Insert in Phase 4 (Scheduled Autonomy).
**Content:**
```markdown
- [ ] **Unit: Wiki Lint (Weekly)**

**Goal:** Weekly health-check of the knowledge base — detect contradictions, stale claims, orphans, missing cross-refs, knowledge gaps.

**Requirements:** R10, R11

**Dependencies:** Unit 6 (wiki schema), Unit 7 (wiki structure exists)

**Files:**
- Create: `.github/workflows/wiki-lint.yaml`
- Create: `scripts/wiki-lint.ts`

**Approach:**
- Weekly scheduled workflow (Sundays 20:00 UTC — matches `fro-bot/agent` WIKI_PROMPT pattern)
- `wiki-lint.ts` scans `knowledge/wiki/` for:
  - Broken wikilinks (target page doesn't exist)
  - Stale claims (source SHA older than 90 days)
  - Orphan pages (no inbound wikilinks)
  - Missing cross-references (page mentions concept but doesn't link)
  - Knowledge gaps (concept referenced but no page exists)
- Detected issues become a WIKI_LINT_PROMPT for agent
- Agent reviews issues, proposes fixes, creates draft PR on `fro-bot/wiki-lint` branch
- Lint results appended to `knowledge/log.md`

**Patterns to follow:**
- `fro-bot/agent/.github/workflows/fro-bot.yaml` WIKI_PROMPT pattern

**Verification:**
- Weekly workflow produces lint report
- Draft PR created for actionable issues
- `log.md` has lint entries
```

### P1-4: Move `metrics.yaml` to Deferred Phase
**Current state**: Unit 2 creates `metadata/metrics.yaml`. Only consumed by deferred phases.
**Fix**: Remove `metrics.yaml` from Unit 2's file list. Document as created by the deferred self-improvement plan when it's implemented. Remove `metadata/metrics.yaml` references from active risk mitigation (rate limit monitoring should log to journal, not metrics.yaml).

### P1-5: Fix R11 Coverage (Incremental Knowledge Growth)
Already addressed by P1-2 Unit 13 (Wiki Query Integration + Event Ingest). Update Requirements Trace to reference the new unit.

### P1-6: R17 Revision — Renovate Dispatch is Autonomous
**Current R17** (origin doc + plan): Approval required for: "Dispatch cross-repo operations (Renovate, branding)"
**Revised R17**: Approval required for: "Cross-repo WRITES that modify code (draft PR creation with file changes, branding PRs). Cross-repo DISPATCH of existing workflows (Renovate) is autonomous — it triggers existing owner-approved workflows rather than writing new code."

Update this in:
- Requirements Trace section of the plan
- Unit 7 (renamed from Unit 10, Renovate) approach section — remove "approval gate" language
- Origin document reference (note the R17 revision in the plan's Open Questions → Resolved During Planning)

### P1-7: Social Curation Hybrid — Update Unit 12
**Current state**: Unit 12 uses full static allowlist + templated content.
**Fix**: Update approach to hybrid:
- **Decision (WHEN)**: Static event-type allowlist + per-type cooldowns determine broadcast eligibility. Deterministic, debuggable.
- **Content (WHAT)**: Once eligibility passes, agent generates the post content via persona voice, platform-appropriate (Discord embed vs BlueSky text).
- Add explicit step: after gate passes, invoke `fro-bot/agent` action with SOCIAL_POST_PROMPT + event context + persona
- SOCIAL_POST_PROMPT defines: 300-char BlueSky limit, Discord embed schema, tone guidance

Also note in Requirements Trace: R20 ("Fro Bot chooses what's interesting") satisfied at content-generation level; eligibility gating is a V1 simplification noted in Scope Boundaries.

### P1-8: PAT Naming — Replace ALL `FRO_BOT_READ_PAT` with `FRO_BOT_POLL_PAT`
Find every occurrence in the plan and replace. Most are in Unit 2 approach, Unit 4 (polling), Unit 5 (survey), and credential boundaries section.

### P1-9: Script Directory — All Scripts Under `scripts/`
Replace every `.github/scripts/` reference with `scripts/`. Consistency across plan.

### P1-10: Unit Renumbering — Sequential Across Phases
After all additions, renumber units sequentially:

**New numbering:**
- **Phase 1: Character First**
  - Unit 1: Persona Document
  - Unit 2: Metadata Structure & Allowlist
  - Unit 3: CI Hardening
- **Phase 2: Core Event Loop**
  - Unit 4: Secrets Hardening (was Unit 3.5)
  - Unit 5: Data Branch Lifecycle (NEW, was P1-1)
  - Unit 6: Wiki Schema & Initial Structure (NEW, was P1-2 part 1)
  - Unit 7: Invitation Polling Workflow (was Unit 4)
  - Unit 8: Repo Survey + Wiki Ingest (was Unit 5, restructured per P1-2 part 2)
  - Unit 9: Enhanced Event Handling with Persona (was Unit 6)
  - Unit 10: Wiki Query Integration + Event Ingest (NEW, was P1-2 part 3)
- **Phase 3: Social Voice + Journal**
  - Unit 11: Discord Notification Script (was Unit 10, content-correct)
  - Unit 12: BlueSky Post Script (was Unit 11)
  - Unit 13: Journal System (was Unit 9)
  - Unit 14: Social Broadcast Integration (was Unit 12, hybrid curation)
- **Phase 4: Scheduled Autonomy**
  - Unit 15: Renovate Smart Dispatch (was Unit 7, now autonomous per R17 revision)
  - Unit 16: Metadata Update Workflow (was Unit 8)
  - Unit 17: Wiki Lint Weekly (NEW, was P1-3)

**Update all cross-references**: every "Dependencies: Unit X" reference must point to the new number.

---

## P2 Improvements

### P2-1: Update Mermaid Diagram
Update High-Level Technical Design diagram to reflect:
- New knowledge architecture (`knowledge/wiki/{repos,topics,entities,comparisons}/`, `index.md`, `log.md`, `schema.md`)
- Wiki operations (ingest, query, lint) as first-class flows
- Data branch flow
- Event ingest flow

### P2-2: Update Requirements Trace
- Note R12-R15 explicitly deferred to separate plan
- Add note for R17 revision (dispatch is autonomous)
- Reference new units for R11

### P2-3: Update Scope Boundaries
- Add note: "This plan does not satisfy origin SC3 (prompt improvement within first month) — SC3 shifts to the deferred self-improvement follow-up plan."
- Note R20 V1 interpretation (hybrid curation, not full AI)

### P2-4: Update Key Technical Decisions
- Add: "Commit strategy differs by scope" (single-file Contents API, multi-file git-based)
- Add: "Wiki uses hybrid ingest (survey + events + weekly lint)" with Karpathy pattern reference
- Add: "Renovate dispatch is autonomous per revised R17 (triggers existing workflows, doesn't write code)"
- Update: "Discord via TypeScript fetch, BlueSky via @atproto/api Node script"
- Update: `scripts/commit-metadata.ts` (was .sh)

### P2-5: Update Risks & Dependencies
- Remove references to `metrics.yaml` for rate limit monitoring (metrics.yaml is deferred) — route rate limit warnings to journal issues instead
- Add risk: "Wiki ingest atomicity" — multi-file commits could partially fail; mitigation via git-based atomic commit
- Add risk: "Wiki query token budget" — excessive query results could blow prompt token budget; mitigation via hard cap + type-priority ranking
- Add risk: "Wiki content poisoning via adversarial repos" — even with capped ingestion, malicious README content could poison wiki; mitigation via output validation + schema checks

### P2-6: Add Reflection Discussions as Deferred
R9 mentions "Discussions for reflection — periodic self-assessment and milestone tracking." No unit currently addresses GitHub Discussions. Add to Deferred section: "R9 GitHub Discussions for reflection — deferred to post-V1, pending operational experience with journal-as-reflection from Unit 13."

### P2-7: Draft PR vs Autonomous Write Clarification
Add to Key Technical Decisions:
> **Draft PRs are proposals, not autonomous writes**. When Fro Bot creates a draft PR in another repo (e.g., proposing `fro-bot.yaml` in Unit 8, or Renovate config in Unit 15's approval mechanism if R17 hadn't been revised), the PR itself is a proposal awaiting human approval. The repo owner's merge action is the authorization. This satisfies R16/R17 even though the PR creation itself is technically a cross-repo write — the content doesn't land in the default branch without human authorization.

---

## Implementation Sequencing

When rewriting the plan:

1. **Start with structural changes first**: Update Phase descriptions, Requirements Trace, Scope Boundaries, Key Technical Decisions
2. **Add new units in the right positions** (P1-1, P1-2 three units, P1-3)
3. **Update existing units per P0 fixes**: all script names, approach sections, PAT names
4. **Swap Unit 7/10 headings** (P0-1)
5. **Renumber all units** (P1-10) — do this LAST after all additions
6. **Update all cross-references** (Dependencies, Files sections) with new numbers
7. **Update Mermaid diagram** (P2-1) to reflect final structure
8. **Update System-Wide Impact, Risks & Dependencies, Sources & References** to be consistent

---

## Validation Checklist

Before declaring the rewritten plan ready:
- [ ] No `.sh` references remain (only `.ts`)
- [ ] No `curl` references in approach sections (only `fetch()` or Octokit)
- [ ] All scripts under `scripts/` (not `.github/scripts/`)
- [ ] No `FRO_BOT_READ_PAT` references (only `FRO_BOT_POLL_PAT`)
- [ ] `yaml` dependency added to package.json in Unit 2
- [ ] Units numbered sequentially 1-17 across 4 phases
- [ ] All Dependencies references use new numbers
- [ ] Unit 7/10 heading swap resolved (post-renumbering: Unit 11 is Discord, Unit 15 is Renovate)
- [ ] Knowledge base has schema.md + index.md + log.md + wiki/{repos,topics,entities,comparisons}/
- [ ] Three Karpathy operations (ingest, query, lint) each have an implementing unit
- [ ] Data branch has a lifecycle unit
- [ ] R11 has implementing unit (Wiki Query Integration + Event Ingest)
- [ ] R17 revision noted in Requirements Trace and Resolved questions
- [ ] Hybrid social curation documented in Unit 14
- [ ] Mermaid diagram reflects new architecture
- [ ] metrics.yaml moved to deferred
- [ ] SC3 deferral noted in Scope Boundaries

---

## Do NOT

- Do NOT change any phase ordering (Phase 1-4, character-first is locked)
- Do NOT revert the "data branch for autonomous writes" decision
- Do NOT weaken `enforce_admins: true` on `main` — the `data` branch pattern is the workaround
- Do NOT re-add Phase 5 (self-improvement) or Phase 6 (releases) — they stay deferred
- Do NOT add features beyond what's in this directives doc
- Do NOT introduce new dependencies beyond `yaml` and `@atproto/api`
