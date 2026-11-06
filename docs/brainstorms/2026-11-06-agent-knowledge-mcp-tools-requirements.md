---
date: 2026-11-06
topic: agent-knowledge-mcp-tools
---

# Knowledge lookups as MCP tools for Fro Bot agent runs

## Summary

A repo-owned MCP server gives every Fro Bot agent job three knowledge tools it can call mid-run: wiki search, solutions search and linked-page expansion. An allowlist pinned by tests decides what the server exposes, and the workflows wire it into each agent step. A fro-bot/agent change keeps credential-free local servers on PR, issue and comment triggers, so reviews and mention replies get the tools too.

---

## Problem Frame

Agents get knowledge context in two ways today, and both are limited.

- **Fixed excerpts.** Before each agent step, `wiki-query` and `solutions-query` rank pages against the run's subject and inject the top excerpts through `WIKI_CONTEXT` and `SOLUTIONS_CONTEXT` (`.github/workflows/fro-bot.yaml:596`, `:618` and the matching Remediate and Observe steps). The agent can't ask a second question once the run is under way.
- **One bash recipe.** The prompts tell the agent to run `bun scripts/wiki-context-expand.ts linked` or `… query "<q>"` (`fro-bot.yaml:661-662`, `:916-917`, `:1078-1079`). The model finds it from prompt text and has to quote shell arguments itself. Solutions have no on-demand path at all.

The scripts consolidation planned for this. Its requirements gave every goke command a read-only or write mark so phase 2 could pick MCP tools, and gated MCP on fro-bot/agent support (R7 and R14 in `docs/brainstorms/2026-10-24-scripts-workspace-packages-requirements.md`, recorded as deferred until fro-bot/agent#1931). That support shipped in agent v0.135.1 (fro-bot/agent#2082). The agent pin here is v0.136.0.

The shipped contract shapes this work:

- On `pull_request`, `issue_comment` and `issues` runs the agent drops the whole `mcp` config (agent `src/services/setup/mcp-servers-v2.ts:307-339` at v0.136.0). Only `schedule` and `workflow_dispatch` runs get servers.
- A local server gets the agent's scrubbed env: `GITHUB_TOKEN`, `GH_TOKEN` and every `*_TOKEN`, `*_SECRET` and `*_KEY` are dropped (`packages/runtime/src/agent/filter-env.ts`). Tools that need GitHub can't work as shipped.
- The Action strips operator `permission`, `permissions` and `tools` keys (`src/services/setup/ci-config-v2.ts:78`, `:85-89`). The default agents allow every MCP tool, so whatever the server exposes, the model can call.
- `readOnly` on a goke command is metadata. Nothing enforces it, and `resolve-private` is marked read-only while printing private repository identities.

---

## Requirements

**Tool surface**

- R1. One MCP server, started from the repo checkout, exposes exactly three tools: wiki search, solutions search and linked-page expansion.
- R2. The server's exposure is an explicit allowlist. Tests fail when a command joins or leaves it, and when the list names any write-marked command or `resolve-private` or `enumerate-existing-leaks`.
- R3. Each tool returns the same content its CLI prints for the same inputs. It keeps the CLI's limits: query validation, the private-page filter from `metadata/repos.yaml` and the byte and page caps.
- R4. A tool returns results only in its tool response. It writes no file in the checkout, no `$GITHUB_OUTPUT` and no handoff file, and its diagnostics carry no input or env values.
- R5. The server needs no credential and reads none. It works under the agent's scrubbed env.

**CLI migration**

- R6. `wiki-context-expand` moves onto the core goke runner. Every invocation shape the prompts use keeps its stdout, stderr and exit code. `correction-lifecycle` stays hand-parsed.

**Wiring**

- R7. Each agent step gets the server through an `mcp` entry defined in the workflow YAML, combined with the `OPENCODE_CONFIG` secret. The server definition and its command are reviewable in the repo.
- R8. The fixed `WIKI_CONTEXT` and `SOLUTIONS_CONTEXT` excerpts stay unchanged.
- R9. Prompts for jobs that run only on `schedule` or `workflow_dispatch` (Remediate, Observe) point the agent at the tools instead of the `wiki-context-expand` bash recipe. The main `fro-bot` job, which also serves PR, issue and comment triggers, keeps the bash recipe and mentions the tools for runs that have them.

**Upstream**

- R10. A fro-bot/agent request asks that, on withheld triggers, local servers with no `{env:}` or `{file:}` reference are kept instead of dropping all of `mcp`. They would run under the same scrubbed env as today.
- R11. When a release with that change is pinned here, the main job's prompt drops the bash recipe in favour of the tools.

---

## Acceptance Examples

- AE1. **Covers R2.** Given a change that adds `resolve-private` or any write-marked command to the allowlist, when the tests run, they fail and name the command.
- AE2. **Covers R1, R5, R9.** Given a scheduled Observe run on the current agent pin, when the agent calls wiki search, it gets ranked wiki content, and the run log shows the call. No GitHub token reaches the server.
- AE3. **Covers R8, R9, R10.** Given a `pull_request` review on the current agent pin, when the run starts, it has no MCP tools. It still gets the fixed excerpts and the bash recipe, so the review behaves as it does today.
- AE4. **Covers R3.** Given a query that names a page tagged with a private repository in `metadata/repos.yaml`, when the agent calls wiki search, that page is left out exactly as the CLI leaves it out.
- AE5. **Covers R6.** Given `bun scripts/wiki-context-expand.ts linked` with `WIKI_CONTEXT_HANDOFF_PATH` set, or `… query "<q>"`, or an invalid query, when it runs after the migration, stdout, stderr and the exit code match today's.

---

## Success Criteria

- Autonomous agent runs call the knowledge tools mid-run, as their logs show, instead of relying only on the pre-step excerpts.
- No tool output or diagnostic carries a private repository identity or a credential.
- PR reviews and mention replies are unchanged until the agent release lands, and then gain the same tools without further work here beyond the pin bump and R11.
- A planner can build this without inventing the tool set, the exposure rule or the trigger behaviour.

---

## Scope Boundaries

- GitHub-read tools (check runs, issues, comments, releases, deploy status). They need the agent to pass a server a token, which is a separate, larger upstream request.
- Exposing other read-only CLIs (CI checks, status-truth reads, metrics).
- Retiring the pre-step excerpts. That follows once the tools prove agents use them.
- Per-tool permission rules in OpenCode config. The Action strips them, so the server allowlist is the control.

---

## Key Decisions

- **Knowledge tools first.** They need no credential, so they are the one tool set that can work on every trigger.
- **goke-native server over prompt-level bash calls.** Tools carry typed schemas the model discovers, and the same server takes future tools. Prompt-only calls would mostly restate what agents can already do. A bash-first phase was skipped because the upstream change is small and in the same owner's repo.
- **Allowlist, not the `readOnly` mark.** The mark is necessary but not sufficient. It doesn't capture public-surface safety, and the Action gives no per-tool permission control.
- **Wiring in the workflows, not the secret.** A server defined only inside `OPENCODE_CONFIG` would be invisible to review.
- **Excerpts stay for now.** Removing them before the tools are proven would cut context from runs whose behaviour is unknown.

---

## Dependencies / Assumptions

- New dependencies: `@goke/mcp` 0.1.2 (published 2026-09-16), which brings `@modelcontextprotocol/sdk` `^1.30.0` and `js-yaml` `^4.1.1`. Both clear the 3-day release-age floor. Adding them needs approval.
- marcusrbrown/infra serves an allowlisted read-only MCP command with `@goke/mcp` (`packages/cli/src/commands/mcp.ts`) and pins the list in `packages/cli/src/conventions.test.ts`. This work follows that shape.
- Unverified: whether a local MCP child also receives `OPENCODE_CONFIG_CONTENT` from the agent's server env. The tools must never echo env, so this matters only for R4.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Needs research] How a workflow combines its `mcp` entry with the `OPENCODE_CONFIG` secret: merge in a step, or an agent input that adds servers on top of `opencode-config`. The second would be another upstream request.
- [Affects R1, R3][Technical] Which implementation backs wiki search: `wiki-context-expand query`, which already validates agent queries, or `wiki-query`.
- [Affects R3][Technical] How linked-page expansion finds the run's handoff file when called as a tool.
- [Affects R1, R6][Needs research] How `@goke/mcp` fits the core runner's rules (help to stderr, ANSI stripping, exit handling), since it drives the goke CLI object directly.
- [Affects R1][Technical] Which package hosts the server, and the server name the model sees in `<server>_<tool>` tool ids.

---

## Sources

- fro-bot/agent v0.136.0: `src/services/setup/mcp-servers-v2.ts`, `src/services/setup/ci-config-v2.ts`, `packages/runtime/src/agent/filter-env.ts`, `packages/runtime/src/agent/server-v2.ts`, `README.md` (MCP section).
- OpenCode 2.2.5: `packages/core/src/tool/mcp.ts` (tool naming and permission ids), `packages/core/src/mcp/stdio.ts` (server spawn and env).
- marcusrbrown/infra: `packages/cli/src/commands/mcp.ts`, `packages/cli/src/conventions.test.ts`, `opencode.jsonc`.
- `docs/solutions/workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md`, `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`.
