---
title: Review shared settings against the full effective inherited configuration
date: 2026-10-09
category: best-practices
module: github-actions-workflows
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - changing `.github/settings.yml` or `common-settings.yaml` in a repo that uses `_extends`
  - reviewing repository-settings changes that touch arrays such as `labels` or `branches`
  - pruning or renaming labels synchronized by repository-settings
  - changing branch-protection checks, restrictions, or review requirements
  - depending on a specific version of the shared settings engine
tags:
  - repository-settings
  - shared-settings
  - inherited-config
  - labels
  - branch-protection
  - drift-guard
  - destructive-sync
  - array-merge
---

# Review shared settings against the full effective inherited configuration

## Context

This repo's `.github/settings.yml` declares `_extends: .github:common-settings.yaml`. The settings
engine (`update-repository-settings` in `bfra-me/.github`) applies the configuration that results
after inheritance, so reviewing only the child file reviews the wrong artifact. Merge behavior is
also per resource: arrays do not all behave alike, and the behavior depends on the engine version
the workflow pins.

The label history shows the trap:

- Before `bfra-me/.github` v4.32.0, `_extends` merged objects but replaced arrays wholesale. A local
  `labels:` list therefore replaced the 48 shared labels. PR #3916 restored them by inlining the
  shared labels into the local file (73 local labels) and added `scripts/settings-label-union.test.ts`
  as a drift guard.
- From v4.32.0, top-level `labels` merge by name. PR #3921 removed the 48 inlined copies again. The
  review did not trust the deletion count; it computed the effective set and confirmed that every
  removed entry matched an inherited entry on name, color, and description. The effective set went
  from 73 to 74 labels, and the only addition was `agent: working`.

The same question applies to `branches:`. The local block declares only required status checks, while
`common-settings.yaml` declares the rest of the branch protection. A correct label review says
nothing about whether that protection survives the merge.

## Guidance

Review shared repository settings against the complete effective payload the sync will apply.

1. **Identify the merge semantics at the pinned engine version.** Read the engine source or release
   notes for the version `.github/workflows/update-repo-settings.yaml` currently pins, not
   documentation or memory. The semantics below start at `bfra-me/.github` v4.32.0, the floor that
   `.github/settings.yml` records for label merging; check the pin before relying on them.

2. **Compute the effective configuration before judging a deletion.** A child-file deletion is safe
   when the value is inherited and destructive when it is not. For labels at v4.32.0 and later,
   merge `common-settings.yaml` and `.github/settings.yml` by lowercase name; a same-name child entry
   replaces the base entry whole.

3. **Compare metadata, not counts.** Preserving 48 label names is not enough if a color or
   description drifted. Compare `name`, `color`, and `description`.

4. **Verify merge semantics per array, not once.** Do not extend the label rule to `branches`,
   `rulesets`, status-check lists, or restriction lists. The next section gives the `branches` rule
   from v4.32.0.

5. **Treat the label list as a deletion-authoritative allow-list.** The label sync deletes labels
   that are absent from the applied entries, which strips them from existing issues and pull
   requests. Adding a label or filling a description patches or creates; removing a label from the
   effective set deletes.

6. **Search for consumers before renaming a label.** PR #3916 renamed `auto-merge` to `automerge`
   only after confirming no workflow consumed the old name. Today `scripts/merge-data-pr.ts` and its
   tests use `automerge`.

7. **Codify the reviewed contract as a drift guard.** `scripts/settings-labels-effective-set.test.ts`
   models the effective label set, rejects duplicate local names, rejects exact local copies of base
   labels, and checks code-declared label descriptors against the merged set.

### Branch protection from v4.32.0

Source read at tags `v4.34.0` and `v4.37.0` (`.github/actions/update-repository-settings/src/config.ts`
is byte-identical at both), with the release note in the action's `CHANGELOG.md` (0.3.0,
`bfra-me/.github#2771`). Re-read `config.ts` at the pinned tag when the pin moves:

- Top-level `branches` entries merge by exact name. A same-name child entry is deep-merged onto the
  base entry.
- Inside a merged entry, the child wins for each key it declares, including an explicit `null`.
  Keys the child omits are inherited. Nested arrays (such as `checks`) are replaced, not merged.
- `checks` and `contexts` are treated as alternatives: if the child declares one, the base's other
  one is dropped.
- Top-level `labels` merge by case-insensitive name; a same-name child entry replaces the base entry
  whole.
- Other arrays, and `labels`/`branches` nested anywhere other than the top level, are not merged by
  name. An array a child declares replaces the base array.

At `v4.31.0` the same function used a plain recursive object merge in which every array was replaced.
A local `branches:` list then replaced the base list outright.

The failure mode therefore depends on the version:

| Engine version | Local `branches: [main]` with only `required_status_checks` | Risk |
| --- | --- | --- |
| Before v4.32.0 | Replaces the base `branches` array | The base protection fields are not applied |
| v4.32.0 and later | Deep-merges onto the base `main` entry | The base fields are inherited silently, including `restrictions: null` |

On v4.32.0 and later, the thing to audit is what the child silently inherits.

## Why This Matters

Repository settings sync is a control plane. A wrong label review deletes labels across issues and
pull requests; a wrong branch-protection review changes the applied protection without a code
failure. Both can ship green: the file parses, and ordinary pull-request CI does not exercise the
settings-sync workflow. The existing required-check doc makes the same point about
`.github/settings.yml`, which nothing validates during PR CI.

The review question is: what will the engine apply after inheritance, merge rules, and version
pinning?

## When to Apply

- Changing `.github/settings.yml`, `common-settings.yaml`, or the pin in
  `.github/workflows/update-repo-settings.yaml`.
- Removing settings from a child file after an upstream merge-semantics change.
- Adding, renaming, pruning, or recoloring labels that automation or triage consumes.
- Editing `branches[].protection`, including `required_status_checks.contexts`, `restrictions`, or
  review requirements.
- Reviewing a PR that claims "no effective change" after deleting inherited configuration.

## Examples

### Labels: review the effective set, not the local diff

The local file records the contract:

```yaml
# Base labels come from common-settings.yaml via _extends, merged by name
# (requires bfra-me/.github >= v4.32.0; older pins replace the base list and delete it).
labels:
  - name: wiki-lint
    color: '#5319e7'
    description: Applied to every wiki-lint issue
```

The drift guard mirrors the engine's merge:

```ts
function computeEffectiveLabels(base: Label[], child: Label[]): Map<string, Label> {
  const effective = new Map<string, Label>()
  for (const label of base) {
    effective.set(label.name.toLowerCase(), label)
  }
  for (const label of child) {
    effective.set(label.name.toLowerCase(), label)
  }
  return effective
}
```

That model is what made PR #3921 reviewable: 48 copied entries left `.github/settings.yml`, each still
present in `common-settings.yaml` with identical metadata.

### Duplicates before rollout

PR #3914 expanded the shared label taxonomy. Review caught `ci/cd` alongside `ci-cd` and kept `ci-cd`
before rollout. After rollout, removing the duplicate would have deleted a label already attached to
issues and pull requests.

### Branch protection: what the child inherits

The child file declares only the status checks:

```yaml
branches:
  - name: main
    protection:
      required_status_checks:
        strict: true
        contexts:
          - Analyze (typescript)
          - Check Types
          - Test
```

From v4.32.0 this entry is deep-merged onto the base `main` entry in `common-settings.yaml`. The
child's `contexts` array replaces the base's `contexts: []`. Fields the child does not declare come
from the base: `enforce_admins: true`, `required_pull_request_reviews`, `required_linear_history:
true`, and `restrictions: null`.

Review the merged result against what the repository needs. In particular, the inherited
`restrictions: null` is part of the applied payload, and `common-settings.yaml` documents `null` as
"disable" for that setting. A repo with live push restrictions that overrides `branches: main`
partially inherits the `null`. If the settings token cannot read
live branch protection (GitHub returns 404 without `administration:read`), verify through the
`update-repo-settings.yaml` run log instead of treating the 404 as evidence either way.

## Related

- [Quote required-status-check contexts that contain a colon](../workflow-issues/quoted-required-status-check-context-2026-06-09.md) — same settings-sync surface, focused on YAML scalar parsing and required-check contexts.
- [Verify Renovate predicates against the live dependency taxonomy](../workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md) — check live tool semantics rather than remembered configuration behavior.
- [Extend status vocabularies across every reporting surface](status-vocabulary-must-cover-every-report-surface-2026-08-31.md) — inventory every surface before changing a finite config vocabulary.
- [Closed-vocabulary identifiers for automated inspection and drift detection](closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md) — label names that automation reads are finite identifiers.
