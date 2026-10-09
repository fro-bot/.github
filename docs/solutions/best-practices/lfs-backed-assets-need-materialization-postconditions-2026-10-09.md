---
title: LFS-backed assets need materialization postconditions, not just green commands
date: 2026-10-09
category: best-practices
module: github-actions-workflows
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - a GitHub Actions workflow copies binary assets that may be tracked by Git LFS
  - a script or delegated prompt runs Git LFS commands after checkout
  - a command can exit 0 after doing no useful work
  - asset correctness depends on real bytes, magic bytes, size, or content hashes
  - one workflow already has the correct checkout topology and another reimplements it
related_components:
  - tooling
  - testing_framework
tags:
  - git-lfs
  - lfs-assets
  - github-actions
  - checkout-topology
  - postconditions
  - magic-bytes
  - exit-zero
  - branding
---

# LFS-backed assets need materialization postconditions, not just green commands

## Context

PR #3876 fixed the branding workflow after review found that the avatar copy step could copy a Git
LFS pointer as if it were a PNG. `.gitattributes` tracks `*.png` with the LFS filter, so a checkout
that does not request LFS content holds only the pointer text for `assets/fro-bot.png` (132 bytes).

The first attempted repair used `git lfs checkout`. That command materializes only objects already in
the local LFS cache. The delegated Fro Bot checkout used `fetch-depth` and a token but no `lfs: true`,
so the cache was empty. Review reproduced the result: `git lfs checkout assets/fro-bot.png` printed
`content not local. Use fetch to download.`, exited 0, and left the file at 132 bytes.

The merged workflow (`.github/workflows/apply-branding.yaml`) runs `git lfs pull
--include=assets/fro-bot.png` in the source checkout, then fails closed unless the source file starts
with PNG magic bytes, and verifies the destination the same way after a binary-safe copy.

## Guidance

Treat LFS materialization as a postcondition, not a command status.

1. **Configure the checkout when you own it.** If a workflow needs LFS-backed files, set
   `lfs: true` on `actions/checkout`. `.github/workflows/publish-wiki.yaml` does, with a comment that
   otherwise the checkout yields 132-byte pointer files and icon generation fails, and
   `scripts/publish-wiki-workflow.test.ts` guards the option.

2. **Do not use `git lfs checkout` as a fetch.** It reads the local object cache. If the cache is
   empty it can skip the file and still exit 0.

3. **When acting after a checkout you do not control, use a command that fetches.** The delegated
   branding prompt cannot change the reusable workflow's checkout, so it runs a scoped pull from the
   source checkout:

   ```bash
   git lfs pull --include=assets/fro-bot.png
   ```

4. **Gate on bytes, not exit codes.** For a PNG, check the magic bytes `89504e470d0a1a0a` on the
   source before copying and on the destination after. For other binary assets use the equivalent
   invariant: size, magic bytes, checksum, or a successful decode.

5. **Look for an existing solved topology before writing a local repair.** `publish-wiki.yaml` already
   had the correct checkout and a test guarding it; the branding workflow rederived a weaker fix
   because nothing connected the two.

## Why This Matters

`set -e` guards against non-zero exits only. A command that exits 0 after doing nothing useful passes
it, and Git LFS reports the problem in text while the shell sees success.

Copying a pointer in place of a binary is worse than failing early. A 132-byte text file passes
ordinary copy logic and is invalid as an image. The safe boundary is the asset's observable state: real
PNG bytes in the source and in the destination.

This is adjacent to CI-topology verification but narrower. Topology asks whether the environment
contains the data a command depends on. A postcondition asks whether the command produced the state
the next step consumes. You need both.

## When to Apply

- A workflow copies images, fonts, archives, or other binary assets out of a checkout.
- The asset path matches a `.gitattributes` LFS filter.
- A delegated agent or script runs after checkout and assumes LFS content is present.
- A command can succeed while skipping work, falling back, or only logging a warning.
- A review says "verified locally" for behavior that depends on checkout options, clone depth, or a
  local cache.

## Examples

### Local-only command treated as success

```bash
set -e
git lfs checkout assets/fro-bot.png
cp assets/fro-bot.png "$target/assets/fro-bot.png"
```

This can exit 0 while `assets/fro-bot.png` is still a pointer. The copy succeeds and the asset is
wrong.

### Checkout owns materialization

```yaml
- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
  with:
    lfs: true
```

Use this when the workflow owns the checkout and later steps expect real LFS-backed files.

### Post-checkout: fetch, then verify

An illustrative shape (the branding workflow states these checks in the delegated prompt rather than
as a script):

```bash
git lfs pull --include=assets/fro-bot.png

python - <<'PY'
from pathlib import Path

png_magic = bytes.fromhex("89504e470d0a1a0a")
if not Path("assets/fro-bot.png").read_bytes().startswith(png_magic):
    raise SystemExit("source asset is not a materialized PNG")
PY
```

Copy with a binary-safe filesystem copy, then verify the destination the same way. The exit code gets
you to the check; the check proves the state.

## Related

- [Verify in the CI topology, not just locally](verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — the environment must contain the files, dependency trees, history, or LFS objects the claim depends on.
- [Lockfiles are advisory until the build gates them](../workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md) — the same shape: a green command is not evidence of the expected state; gate the postcondition.
- [Make failure boundaries and shared predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md) — distinguish a legitimate no-op from an unsafe continuation.
- [A code path exercised only by pre-built fixtures is an untested seam — test the seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — test the workflow or file seam the behavior crosses.
- Source PR: #3876 (merge `56dc86b`).
