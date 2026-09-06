---
type: entity
title: Pi (coding agent)
created: 2026-09-05
updated: 2026-09-05
sources:
  - url: https://github.com/marcusrbrown/systematic
    sha: 9bceff393c4d14c76b01625b9268d08d37fc4f01
    accessed: 2026-09-05
tags: [pi, coding-agent, harness, agent-harness, extensions, skills, subagents, typebox, npm]
aliases: [pi-coding-agent, earendil-works/pi-coding-agent]
related:
  - marcusrbrown--systematic
  - opencode-plugins
  - fro-bot--systematic
---

# Pi (coding agent)

AI coding agent harness distributed as `@earendil-works/pi-coding-agent` (upstream: `earendil-works/pi-coding-agent`). Entered this wiki on 2026-09-05 as a **Tier 1 shipped adapter target** of [[marcusrbrown--systematic]] v3, alongside OpenCode and Claude Code.

Everything on this page is observed indirectly, from a consumer that integrates with Pi rather than from Pi's own repository. Treat it as an integrator's-eye view; a direct upstream survey has not been done.

## Why it matters here

Pi is the second harness [[marcusrbrown--systematic]] ships a native adapter for, and its arrival is what turned Systematic from "an OpenCode plugin" into a multi-harness workflow system. Before v3 the ecosystem had exactly one agent harness in view ([[opencode-plugins]]); Pi is the first credible second, and the first case where a package in this ecosystem had to express "works on either host, requires neither."

## Integration surface (as consumed by Systematic v3.16.1)

**Version pinned:** `@earendil-works/pi-coding-agent` **0.83.0**, present twice — as an **optional** `peerDependency` at `^0.83.0` and as an exact `devDependency`. A companion `overrides` entry pins `@earendil-works/pi-ai` to `0.83.0` in lockstep. `typebox` (`^1.1.38` peer, `1.3.25` dev) travels with it, suggesting Pi's extension API is TypeBox-typed where OpenCode's is Zod-typed.

**Manifest key.** Pi discovers integrations through a top-level `"pi"` block in `package.json`:

```jsonc
"pi": {
  "extensions": ["./dist/pi.js"],
  "skills": ["./skills"]
}
```

Two distinct registration channels — executable *extensions* and a *skills* directory — declared in the host package's own manifest rather than a separate config file. Note the consequence for packaging: the same published tarball serves OpenCode (via `exports["."]` → `dist/index.js`) and Pi (via `pi.extensions` → `dist/pi.js`) with no separate artifact.

**Build target divergence.** Systematic builds its OpenCode entry points with `bun build --target bun` and its Pi entry point with `bun build --target node`, externalizing `@earendil-works/pi-coding-agent`, `typebox`, and `jsonc-parser`. Pi is treated as a Node host, OpenCode as a Bun host.

**Subagents are a separate package.** `@tintinweb/pi-subagents` (0.14.3, devDependency) backs an opt-in persona export path. Systematic generates 30 `systematic-*.md` persona files plus a `systematic-personas-manifest.json` from its own agent definitions (`scripts/generate-pi-subagents-personas.ts`), committed as golden fixtures and drift-checked.

## Capability profile

From [[marcusrbrown--systematic]]'s `HARNESSES.md` capability matrix, which cites each claim to an evidence registry:

| Capability | Pi | Compare: OpenCode |
| --- | --- | --- |
| Subagent delegation | Bounded built-in delegate `systematic_delegate({agent, task})` — **sequential, capped at 20 turns, depth-1, `noExtensions`**. Mature delegation available via opt-in `pi-subagents` export, explicitly outside the bounded-delegate guarantees. | `task` with `subagent_type`, resume, and background execution |
| Blocking user interaction | **No native blocking tool.** Documented fallback: numbered options in chat, wait for reply. | `question` |
| Task tracking | **No native mechanism.** Documented fallback: maintain a visible list in responses. | `todowrite` |
| Skill loading | `systematic_skill` adapter plus Pi-native activation | Skills become commands; `systematic_skill` registered |
| `SKILL.md` support | Yes, via `pi.skills` shipping `./skills` | Yes |

The two gaps are the interesting part. Pi has no blocking-question primitive and no task-tracking primitive, so a workflow system targeting it must degrade to prose conventions for both. This is why Systematic's skills are written to describe fallbacks rather than assume tool availability, and it is the concrete meaning of "content parity, not capability parity."

The **depth-1, 20-turn, `noExtensions`** delegate cap is worth recording on its own. It is a bounded-by-construction delegation model: a delegated Pi agent cannot recursively delegate, cannot run indefinitely, and cannot load extensions. That trades capability for a guarantee about blast radius — the opposite trade from OpenCode's `task`, which permits background and nested dispatch. Systematic exposes both and marks which one carries the guarantee.

## Observed constraint: the guard did not follow

Systematic's largest subsystem — the workflow guard and receipt ledger — is **OpenCode-only**. Open issue **#854** in [[marcusrbrown--systematic]] states the reason is the guard's *state model*, not a Pi limitation. So the practical parity boundary as of 2026-09-05 is:

- **Carries over:** skill content, agent content, `SKILL.md` discovery, skill loading, bounded delegation.
- **Does not carry over:** workflow guard, receipt/attestation enforcement, and the blocking-question and task-tracking primitives those flows assume.

## Open questions

- Pi's own release cadence, licensing, and repository health are unsurveyed. `0.83.0` on a `0.x` line implies no stability guarantee, which makes the `^0.83.0` peer range wider than it looks — under semver, `^0.x.y` allows only patch-level drift, so the range is in fact narrow, but the upstream is pre-1.0 and may break within it.
- Whether `@tintinweb/pi-subagents` is first-party to Pi or a third-party ecosystem package is not established from the consumer side; the differing npm scope suggests the latter.

## Related Pages

- [[marcusrbrown--systematic]] — the tri-harness consumer; source of every observation here
- [[opencode-plugins]] — the OpenCode-side plugin patterns Pi is now contrasted against
- [[fro-bot--systematic]] — deploy target hosting the docs and registry that describe the Pi install path
