# `@fro.bot/wiki-write-core`

Shared validation and commit primitives for Fro Bot wiki writes: snapshot lint, wiki ingest, privacy-core seams, frontmatter helpers, and rendering-policy validation.

## Install

```bash
pnpm add @fro.bot/wiki-write-core
# or: npm install @fro.bot/wiki-write-core
# or: bun add @fro.bot/wiki-write-core
```

## Runtime requirements

- Node `>=24`.
- **ESM-only.** The exports declare `import` and `types` conditions, with no `require` condition and no CommonJS build. CommonJS consumers fail at package resolution by design.

The package ships unbundled ESM JavaScript with declaration files from the committed `dist/` directory. No install-time build step is required. CI rebuilds `dist/` in a temporary directory and fails when the committed output differs from `src/`.

## Fro Bot defaults

The package targets the Fro Bot control plane and carries its coordinates as defaults. Each is overridable through the call's parameters.

- `owner` defaults to `fro-bot` (`DEFAULT_OWNER`), and `repo` to `.github`.
- The canonical write target is the `fro-bot/.github@data` tuple: `branch` defaults to `data`.
- Tracked-repository metadata is read from `metadata/repos.yaml`.

When a call receives no Octokit client (`params.octokit`), it reads `GITHUB_TOKEN` from the environment and fails with a remediation message if the variable is unset.

The build also emits `dist/gate-contract.json` with `version` from `GATE_CONTRACT_VERSION` and `sourceTreeHash` from the same computed source hash embedded in `gate-contract.js`. Downstream writers can fetch this marker through the repository contents API; the same distribution drift check verifies the committed marker. `version` is the gate criterion: a mismatch means a deliberate contract break and refuses writes. `sourceTreeHash` is diagnostic only: it moves with ordinary source changes and reports drift in the pinned copy, but must never block writes.

The package exports `GATE_CONTRACT_VERSION` and `GATE_SOURCE_TREE_HASH` from its root entrypoint. The build embeds a deterministic hash covering every non-test TypeScript file under `src/`, the resolved `tsconfig.build.json` configuration including inherited settings, and canonicalized `exports` and `files` values from `package.json`. Object-key order and `files` array order do not affect the hash. The hash does not cover tests, this README, other manifest fields such as dependencies or version, or runtime dependencies. Because it hashes the _resolved_ compiler configuration, a TypeScript upgrade that changes an inherited default or the `--showConfig` serialization moves the hash with no semantic change to the shipped code; a hash that shifts across a compiler bump is expected and does not by itself indicate gate drift.

`GATE_SOURCE_TREE_HASH` is the automatic drift detector: compare it when you need to know whether the shipped gate inputs changed. `GATE_CONTRACT_VERSION` is a deliberate, human-set marker for an intentional consumer-visible contract break; it is not expected to change for every source edit. Neither value proves that dependencies or the runtime behave identically. Consumers should compare the source hash for ordinary gate-input drift and the contract version when deciding whether an intentional contract migration is required.

`gate-contract.json` is intentionally not exposed through the package `exports` map. Consumers must fetch the control plane's current marker through the contents API while loading their pinned package copy locally; resolving the bundled marker would defeat that comparison.

## Finding kinds

`WikiLintFindingKind` includes `correction-eroded` for a blocking active-correction failure and `correction-needs-reconfirmation` for an advisory lifecycle or formatting-only change. Both retain the existing `{kind, path, message, target?}` runtime shape and fingerprint derivation. Consumers with exhaustive matches must handle both kinds.

## Releasing

A merge to `main` that changes `packages/wiki-write-core/` releases the package through `.github/workflows/release-wiki-write-core.yaml`. Versions are the `wiki-write-core-v<version>` tags (for example `wiki-write-core-v0.1.1`), and each tag has a GitHub release.

Only commits that touch `packages/wiki-write-core/` are analyzed. The commit type decides the release:

| Commit                                                                                          | Release |
| ----------------------------------------------------------------------------------------------- | ------- |
| Breaking change (`!` or a `BREAKING CHANGE:` footer)                                            | minor   |
| `feat`                                                                                          | minor   |
| `fix`, `build`, `docs(readme)`                                                                  | patch   |
| `build(dev)`, other `docs`, `chore`, `ci`, `test`, `refactor`, `skip`, non-conventional commits | none    |

- A scoped suppression wins over a breaking marker: `build(dev)!:` releases nothing.
- While the package is 0.x it never releases a major version; a breaking change is a minor bump.
- A commit containing `[skip release]` (or `[release skip]`) is ignored by the release analysis.

### Publishing

The `publish` job uses npm trusted publishing (OIDC) from `release-wiki-write-core.yaml` in the `release` environment, and publishes with provenance. There is no npm token. It publishes the committed `dist/`, which the `build` job proves equals a fresh build.

Verify a release:

- `npm view @fro.bot/wiki-write-core dist-tags.latest` returns the released version.
- `npm view @fro.bot/wiki-write-core@<version> --json` lists the provenance attestation under `dist.attestations`.
- The version page on npmjs.com shows the provenance badge, linking to `fro-bot/.github` and `release-wiki-write-core.yaml`.

### Failure recovery

Start from the registry and tag state, not from the run's conclusion: a green run can release nothing.

| State | Recovery |
| --- | --- |
| No tag, no npm version | Fix the cause, then run the workflow with `workflow_dispatch` on `main` |
| Green run, package commits since the last tag, no release (`main` moved past the checkout, or the push run was skipped by `[skip ci]`) | `workflow_dispatch` on `main` |
| Tag present, version neither live nor staged on npm | Delete the tag and its GitHub release if one exists, then `workflow_dispatch` on `main`. Do this before merging any other package change |
| Tag and GitHub release present, npm skipped the publish (for example `private` in the manifest) | Fix the manifest, delete the tag and GitHub release, then `workflow_dispatch` on `main` |
| Version staged on npm instead of live | Promote it on npm, then set the trusted publisher to allow `npm publish` |
| OIDC publish fails (expired, misconfigured or stage-only trusted publisher) | Delete and recreate the trusted publisher: owner `fro-bot`, repo `.github`, workflow `release-wiki-write-core.yaml`, environment `release`, allowed action `npm publish`. Then resolve the tag as in the third row |
| Tag and version live, no GitHub release | Create the GitHub release from the tag. Never delete the tag |
| Bad version published | Deprecate it and ship a fix release. Never delete the tag |
