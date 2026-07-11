---
title: Lockfiles are advisory until the build gates them
date: 2026-07-11
category: workflow-issues
module: wiki-site
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "a tool installs dependencies from a lockfile but the build path does not verify the lockfile was honored"
  - "a dependency can be declared/enabled in config without a corresponding lock entry"
  - "an installer logs failures but exits zero"
  - "pinning to immutable commits is a security requirement, not a convenience"
related_components:
  - development_workflow
tags:
  - lockfile
  - supply-chain
  - fail-closed
  - branch-tip-drift
  - pin-integrity
  - quartz
---

# Lockfiles are advisory until the build gates them

## Context

The wiki site's Quartz v5 migration expanded the build-time supply chain from one pinned repo to ~30 community plugins installed from git, pinned per-commit in a committed `quartz.lock.json`. The plan assumed "committed lockfile ⇒ pinned installs." A prerequisite spike disproved that empirically, three ways:

1. The package's `prebuild` hook **ignores the lockfile entirely** — it installs from config. Only the explicit `quartz plugin install` CLI path reads the lock.
2. Even on the lockfile path, a plugin that is **enabled in config but missing from the lockfile is silently fetched at branch tip** during `quartz build` — its `.git/HEAD` ends up as `ref: refs/heads/main`, not a pinned SHA. Reproduced live: removing one lock entry and rebuilding produced a floating install with exit 0.
3. The installer can **log a failure and still exit zero**, so a green install step proves nothing.

A committed lockfile with none of this gated is pin *theater*: it documents intent while the build quietly installs whatever the branch tip serves.

## Guidance

Treat a lockfile as untrusted input to the build until the pipeline proves it was honored. The enforcement shape that works is a **three-way fail-closed gate**:

1. **Pre-install coverage gate** — parse config and lockfile; assert every enabled remote dependency has a lock entry (and no orphan entries, and no source shapes the pin can't cover). This closes the enabled-but-unlocked bypass *before* any network fetch.
2. **Install via the lockfile-honoring path only** — the exact invocation matters; hooks and convenience wrappers may bypass the lock. Never use re-resolving variants (`--latest`, `--from-config`).
3. **Post-install integrity gate** — assert each installed dependency's actual state matches its lock pin. For git-cloned deps that's `.git/HEAD` content equal to the lock commit; a `ref:` line (branch checkout) is drift and fails exactly like a wrong SHA. Postconditions are mandatory because the installer's exit code is not evidence.

```text
coverage gate (fail-closed) → lockfile install → HEAD == lock commit (fail-closed) → build
```

Each gate's branch logic (orphan detection, source-shape rejection, drift-as-ref detection) belongs in a tested module, not inline workflow scripting — the gate is a security control and gets the same mutation-proof test discipline as any other (a tampered lock must fail the test suite).

## Why This Matters

The bypass is silent and looks exactly like success: green install step, green build, deployed site — with one dependency floating at branch tip, where a compromised upstream commits directly into your next build. The whole point of pinning is defeated by the one dependency that escaped the lock. And because the failure mode is *absence of an error*, no amount of watching logs catches it; only an explicit postcondition comparison does.

## When to Apply

- Any build that installs dependencies from per-repo git pins (Quartz community plugins, vendored actions, git submodule alternatives).
- Any ecosystem where the lockfile is opt-in at install time rather than enforced (verify, don't assume — the spike that proved Quartz's behavior took minutes and invalidated the plan's central assumption).
- Security-sensitive pipelines where the pinned-commit claim appears in review or documentation — if the claim isn't machine-enforced, it drifts.

## Examples

The bypass, reproduced:

```bash
# Remove one plugin's lock entry, keep it enabled in config, rebuild:
#   → plugin silently installed from branch tip
#   → .git/HEAD contains "ref: refs/heads/main"  (not a SHA)
#   → build exit 0
```

The post-install gate that catches it:

```ts
for (const [name, entry] of Object.entries(lock.plugins ?? {})) {
  const head = readHead(name) // .quartz/plugins/<name>/.git/HEAD, trimmed
  if (head === null) errors.push(`missing plugin directory for "${name}"`)
  // A "ref: refs/heads/..." line never equals a commit SHA — branch drift
  // fails identically to a mismatched pin.
  else if (head !== entry.commit) errors.push(`"${name}" HEAD ${head} != lock ${entry.commit}`)
}
```

## Related

- [Credential mint-time permission scoping](../best-practices/credential-mint-time-permission-scoping-2026-06-22.md) — same class one layer over: an assumed protection that is real only if the enforcement boundary actually checks it.
- [Verify the whole public perimeter](../security-issues/verify-whole-public-perimeter-2026-06-22.md) — enforcement-by-complete-verification: the gate must cover every surface, not the convenient subset.
- [Verify in the CI topology, not just locally](../best-practices/verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — the companion lesson from the same migration: the gate module itself shipped with a resolution bug that only the CI topology exposed.
