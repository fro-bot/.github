---
date: 2026-11-06
topic: agent-knowledge-mcp-tools
---

# Knowledge lookups as MCP tools for Fro Bot agent runs

## Summary

A repo-owned MCP server gives Fro Bot agent runs three knowledge tools they can call mid-run: wiki search, linked-page expansion and solutions search. A test-pinned allowlist decides what the server exposes, and one shared workflow action wires it into the Fro Bot agent jobs and survey. Scheduled and dispatched runs, plus review-comment and discussion mentions, get the tools on the current agent pin. PR, issue and issue-comment runs get them once a requested fro-bot/agent change ships.

---

## Problem Frame

Agents get knowledge context in two ways today, and both are limited.

- **Fixed excerpts.** Before each agent step, `wiki-query` and `solutions-query` rank pages against the run's subject and inject the top excerpts through `WIKI_CONTEXT` and `SOLUTIONS_CONTEXT` (`.github/workflows/fro-bot.yaml:596`, `:618` and the matching Remediate and Observe steps). The agent can't ask a second question once the run is under way.
- **One bash recipe.** The prompts tell the agent to run `bun scripts/wiki-context-expand.ts linked` or `… query "<q>"` (`fro-bot.yaml:661-662`, `:916-917`, `:1078-1079`). The model finds it from prompt text and quotes shell arguments itself. Solutions have no on-demand path.

The scripts consolidation planned for this. It gave every goke command a read-only or write mark so a later phase could pick MCP tools, and it gated MCP on fro-bot/agent support (R7 and R14 in `docs/brainstorms/2026-10-24-scripts-workspace-packages-requirements.md`, recorded as deferred until fro-bot/agent#1931). That support shipped in agent v0.135.1 (fro-bot/agent#2082). The agent pin here is v0.136.0.

The shipped contract shapes this work:

- The agent classifies each event (agent `packages/runtime/src/agent/response-delivery.ts:30-43`). It drops the whole `mcp` config on `pull_request`, `issue_comment` and `issues` (`src/services/setup/mcp-servers-v2.ts:307-339`). Every other event keeps it, including `pull_request_review_comment` and `discussion_comment`, which the main `fro-bot` job also runs on (`fro-bot.yaml:14`, `:16`).
- A local server inherits the agent's scrubbed env. Every `*_TOKEN`, `*_SECRET` and `*_KEY` is dropped, and so is `WIKI_CONTEXT_HANDOFF_PATH` (`packages/runtime/src/agent/filter-env.ts`). The env still carries `OPENCODE_PASSWORD` and `OPENCODE_CONFIG_CONTENT` (`packages/runtime/src/agent/server-v2.ts:407-411`).
- The agent's only config channel is the `opencode-config` input (`action.yaml:98-102`). It strips operator `permission`, `permissions` and `tools` keys (`src/services/setup/ci-config-v2.ts:78`, `:85-89`), and the default agents allow every MCP tool. Whatever the server exposes, the model can call.
- `readOnly` on a goke command is metadata. Nothing enforces it, and `resolve-private` is marked read-only while printing private repository identities.
- `@goke/mcp` drives a goke instance's command actions directly. The core runner builds its goke instance privately (`packages/core/src/cli.ts:453`), so the server can't sit on top of `runCli`.

| Trigger                                             | MCP on agent v0.136.0 | After the upstream change              |
| --------------------------------------------------- | --------------------- | -------------------------------------- |
| `schedule`, `workflow_dispatch`                     | kept                  | kept                                   |
| `pull_request_review_comment`, `discussion_comment` | kept                  | kept                                   |
| `pull_request`, `issue_comment`, `issues`           | dropped               | kept for credential-free local servers |

---

## Requirements

**Tool surface**

- R1. One MCP server, started from the repo checkout, exposes exactly three tools: wiki search, linked-page expansion and solutions search. The server builds its own goke instance as the tool registry and serves it through `@goke/mcp`. Tool arguments arrive as JSON, so no goke flag parsing touches them.
- R2. The server's exposure is an explicit allowlist. Tests fail when a command joins or leaves it, and when the list names any write-marked command, `resolve-private` or `enumerate-existing-leaks`.
- R3. Wiki search and linked-page expansion call `wiki-context-expand`'s existing query and linked functions. They return what the CLI prints for the same input, with its query validation, private-page filter and byte and page caps. The CLI and its hand-written parser stay as they are.
- R4. Solutions search takes a query and reuses `solutions-query`'s ranking, private-name filter and caps. A failure returns an error result the model can tell apart from "no matches".
- R5. Linked-page expansion reads the run's handoff path from the server definition, set per job as a literal value. No tool takes a path argument. A missing or malformed handoff file returns an error result, not empty content.
- R6. A tool returns results only in its tool response. The server writes no file, no `$GITHUB_OUTPUT` and no handoff file. Its stderr carries only fixed messages and error codes, never an env value, a query or a path.
- R7. The server needs no credential. At startup it removes `OPENCODE_PASSWORD` and `OPENCODE_CONFIG_CONTENT` from its in-process environment. This narrows what its own code and dependencies can read. It is not an isolation boundary. Its working directory is set explicitly to the checkout root.

**Wiring**

- R8. One shared composite action builds each agent step's `opencode-config`. It reads the `OPENCODE_CONFIG` secret through `env:` and treats an empty secret as `{}`. It adds the server definition and writes no `{env:}` or `{file:}` reference. It fails the job when the secret doesn't parse or already defines a server with the same name. On a fork PR it passes the secret through unchanged. The main `fro-bot` job, Remediate, Observe and all three survey attempts use it. capture-learnings, capture-patterns and draft-solutions keep the raw secret: their prompts limit them to a supplied digest, and draft-solutions runs on an older checkout.
- R9. The fixed `WIKI_CONTEXT` and `SOLUTIONS_CONTEXT` excerpts stay unchanged.
- R10. Prompts for the three Fro Bot jobs tell the agent to use the tools when the run lists them, and to fall back to the `wiki-context-expand` bash recipe otherwise. Survey prompts mention the two search tools.

**Upstream**

- R11. One fro-bot/agent request asks that, on `pull_request`, `issue_comment` and `issues`, local servers with no `{env:}` or `{file:}` reference are kept instead of dropping all of `mcp`. The whole-config `{env:}` rejection (`ci-config-v2.ts:172`) stays, and so does `{file:}` key removal for every key that isn't a kept server.
- R12. When a release with that change is pinned here, the Fro Bot prompts drop the bash recipe fallback.

---

## Acceptance Examples

- AE1. **Covers R2.** Given a change that adds `resolve-private` or any write-marked command to the allowlist, when the tests run, they fail and name the command.
- AE2. **Covers R1, R7.** Given a scheduled Observe run, when the agent calls wiki search, it gets ranked wiki content. The server's code sees no GitHub token, `OPENCODE_PASSWORD` or `OPENCODE_CONFIG_CONTENT`.
- AE3. **Covers R10, R11.** Given a `pull_request` review on agent v0.136.0, when the run starts, it has no MCP tools and still gets the excerpts and the bash recipe. Given a `pull_request_review_comment` mention on the same pin, the run has the tools.
- AE4. **Covers R3.** Given the query `-foo bar`, when the agent calls wiki search, it gets the same result the CLI's hand parser gives `query "-foo bar"`.
- AE5. **Covers R5.** Given the job's handoff file is missing, when the agent calls linked-page expansion, it gets an error result naming no path.

---

## Success Criteria

- Scheduled and dispatched agent runs, plus review-comment and discussion mentions, call the knowledge tools mid-run.
- No tool output or server stderr carries a private repository identity or a credential.
- PR reviews and issue and issue-comment replies are unchanged until the agent release lands, except that a malformed `OPENCODE_CONFIG` secret now fails them too. They then gain the tools with only the pin bump and R12.
- A planner can build this without inventing the tool set, the exposure rule, the trigger behaviour or the wiring.

---

## Scope Boundaries

- GitHub-read tools (check runs, issues, comments, releases, deploy status). They need the agent to pass a server a token, which is a separate, larger upstream request.
- Exposing other read-only CLIs (CI checks, status-truth reads, metrics).
- Retiring the pre-step excerpts. That follows once the tools prove agents use them.
- Per-tool permission rules in OpenCode config. The Action strips them, so the server allowlist is the control.
- Strengthening the CLIs' private-name filters. See the privacy decision below.

---

## Key Decisions

- **Knowledge tools first.** They need no credential, so they can work on every trigger once R11 lands.
- **The server owns its goke registry.** It uses `@goke/mcp` the way marcusrbrown/infra does, and its commands call existing functions. The goke runner would read a free-text query starting with `-` as a flag, which is why `wiki-context-expand` keeps a hand parser (`packages/wiki-ops/src/wiki-context-expand-cli.ts:4-5`). Calling the functions directly leaves the CLIs and the core runner untouched.
- **Allowlist, not the `readOnly` mark.** The mark is necessary but not sufficient. It doesn't capture public-surface safety, and the Action gives no per-tool permission control.
- **Wiring in one shared action, not the secret.** A server defined only inside `OPENCODE_CONFIG` would be invisible to review, and per-step copies would drift.
- **Privacy rests on the node-ID gates.** On default-branch and `data`-overlay runs, the write-time wiki presence gate and the promotion leak gate keep private identities out of `knowledge/` and `docs/solutions/`. On PR-checkout runs, the corpus includes the PR's own content, as the excerpts already do. The CLIs' private-name filters are defense-in-depth and are inert today: every private entry in `metadata/repos.yaml` carries `owner: '[REDACTED]'` on both `main` and `data`, and both loaders skip redacted entries (`packages/wiki-ops/src/solutions-query.ts:399`, `packages/wiki-ops/src/wiki-context-expand.ts:238`). The tools reuse those filters unchanged.
- **Excerpts stay for now.** Removing them before the tools are proven would cut context from runs whose behaviour is unknown.
- **No call-volume baseline.** The tools exist to give agents on-demand lookup. Run logs showing the calls are enough evidence.

---

## Dependencies / Assumptions

- New dependencies: `@goke/mcp` 0.1.2 (published 2026-09-16), which brings `@modelcontextprotocol/sdk` `^1.30.0` and `js-yaml` `^4.1.1`. Both clear the 3-day release-age floor. Adding them needs approval.
- marcusrbrown/infra serves an allowlisted read-only MCP command with `@goke/mcp` (`packages/cli/src/commands/mcp.ts`) and pins the list in `packages/cli/src/conventions.test.ts`.
- Unverified: whether the agent's `opencode-logs` artifact records MCP tool calls. If it doesn't, AE2's evidence needs another source.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R8][Technical] Which package hosts the server, and its name. The model sees `<server>_<tool>` tool ids, and the name must not collide with a server in the `OPENCODE_CONFIG` secret.
- [Affects R4][Technical] How solutions search reuses `solutions-query`'s ranking without its env-driven entry point.
- [Affects R5, R8, R10][Technical] The full list of agent steps, their handoff paths and their trigger sets.

---

## Sources

- fro-bot/agent v0.136.0: `src/services/setup/mcp-servers-v2.ts`, `src/services/setup/ci-config-v2.ts`, `packages/runtime/src/agent/response-delivery.ts`, `packages/runtime/src/agent/filter-env.ts`, `packages/runtime/src/agent/server-v2.ts`, `README.md` (MCP section).
- OpenCode 2.2.5: `packages/core/src/tool/mcp.ts` (tool naming and permission ids), `packages/core/src/mcp/stdio.ts` (server spawn, env and stderr handling).
- marcusrbrown/infra: `packages/cli/src/commands/mcp.ts`, `packages/cli/src/conventions.test.ts`, `opencode.jsonc`.
- `docs/solutions/workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md`, `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`.
