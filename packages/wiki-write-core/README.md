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

The published package ships unbundled ESM JavaScript with declaration files in `dist/`. No install-time build step is required.

In the repository the package resolves to its TypeScript source: `exports` maps every subpath to `./src/<name>.ts`, and the only file committed under `dist/` is `gate-contract.json`. The release build compiles `dist/` and stages a manifest that differs from the committed one in `exports` alone, pointing each subpath at `./dist/<name>.js` with `./dist/<name>.d.ts` as its types. `npm pack` and `npm publish` run from that staged directory, so the committed manifest is never rewritten.

`bun run check:wiki-write-core-package` is the local and CI check: it builds the package, fails when the committed `dist/gate-contract.json` differs from the fresh build, packs the staged package, unpacks the tarball into a scratch `node_modules`, then resolves and imports every `exports` subpath under Node and type-checks a consumer module that imports them all. `bun run build` rewrites the committed marker after a change under `src/`, `tsconfig.build.json` or the manifest's `exports` or `files`.

`--stage <dir>` replaces whatever is at `<dir>`, so it refuses anything but a target that resolves (through symlinks) to somewhere strictly under the OS temp directory or `RUNNER_TEMP`, and it replaces an existing directory only when a previous stage left its `wiki-write-core-stage.marker` there. A root must be absolute and must not resolve to a filesystem root (so `RUNNER_TEMP=/` is refused), and a stage that contains a hidden file or directory is refused, because `upload-artifact` drops them and the publish job's digest would no longer match. The target is judged before anything is built or written, so a refused run leaves the committed `dist/gate-contract.json` alone, and again just before the replacement. Refusals happen before anything is created, moved or removed. If a replacement fails and the original cannot be restored either, the original is kept in a `.wiki-write-core-dist-backup-*` sibling and the error names it.

## Fro Bot defaults

The package targets the Fro Bot control plane and carries its coordinates as defaults. Each is overridable through the call's parameters.

- `owner` defaults to `fro-bot` (`DEFAULT_OWNER`), and `repo` to `.github`.
- The canonical write target is the `fro-bot/.github@data` tuple: `branch` defaults to `data`.
- Tracked-repository metadata is read from `metadata/repos.yaml`.

When a call receives no Octokit client (`params.octokit`), it reads `GITHUB_TOKEN` from the environment and fails with a remediation message if the variable is unset.

The build also emits `dist/gate-contract.json` with `version` from `GATE_CONTRACT_VERSION` and `sourceTreeHash` from the same computed source hash embedded in `gate-contract.js`. This is the one file committed under `dist/`: downstream writers fetch it from `main`, so it stays at that path. `bun run check:wiki-write-core-package` verifies the committed marker against a fresh build, and the same marker ships in the tarball. `version` is the gate criterion: a mismatch means a deliberate contract break and refuses writes. `sourceTreeHash` is diagnostic only: it moves with ordinary source changes and reports drift in the pinned copy, but must never block writes.

The package exports `GATE_CONTRACT_VERSION` and `GATE_SOURCE_TREE_HASH` from its root entrypoint. In the repository that entrypoint is source, so `GATE_SOURCE_TREE_HASH` is the placeholder `__SOURCE_TREE_HASH__`; only the built `dist/gate-contract.js` in the tarball carries the hash. The build embeds a deterministic hash covering every non-test TypeScript file under `src/`, the resolved `tsconfig.build.json` configuration including inherited settings, and canonicalized `exports` and `files` values of the published manifest (`exports` in its `dist` form). Object-key order and `files` array order do not affect the hash. The hash does not cover tests, this README, other manifest fields such as dependencies or version, or runtime dependencies. Because it hashes the _resolved_ compiler configuration, a TypeScript upgrade that changes an inherited default or the `--showConfig` serialization moves the hash with no semantic change to the shipped code; a hash that shifts across a compiler bump is expected and does not by itself indicate gate drift.

`GATE_SOURCE_TREE_HASH` is the automatic drift detector: compare it when you need to know whether the shipped gate inputs changed. `GATE_CONTRACT_VERSION` is a deliberate, human-set marker for an intentional consumer-visible contract break; it is not expected to change for every source edit. Neither value proves that dependencies or the runtime behave identically. Consumers should compare the source hash for ordinary gate-input drift and the contract version when deciding whether an intentional contract migration is required.

`gate-contract.json` is intentionally not exposed through the package `exports` map. Consumers must fetch the control plane's current marker through the contents API while loading their pinned package copy locally; resolving the bundled marker would defeat that comparison.

## Finding kinds

`WikiLintFindingKind` includes `correction-eroded` for a blocking active-correction failure and `correction-needs-reconfirmation` for an advisory lifecycle or formatting-only change. Both retain the existing `{kind, path, message, target?}` runtime shape and fingerprint derivation. Consumers with exhaustive matches must handle both kinds.

A page that opens a frontmatter block and never closes it is reported as `invalid-frontmatter`; it was reported as `missing-frontmatter` while the block was read as no block. Wiki repair counts such a page as out of scope, as it does for any `invalid-frontmatter` finding.

## Frontmatter block

`splitFrontmatterBlock(content)` (exported from the root entry and from `@fro.bot/wiki-write-core/frontmatter`) finds the YAML frontmatter block at the start of a document. It does not parse YAML. The root entry already exports the wiki page reader as `splitFrontmatter`, so the splitter has another name.

- The block opens only when the content starts with a line that is exactly `---`. A trailing space, a byte-order mark or a blank line before it means there is no block.
- A line ending is LF or CRLF; a lone CR is part of its line.
- The block closes at the first later line that is `---` followed only by spaces or tabs. `---x`, `----` and `--- text` are content of the block.
- The result is `{kind: 'none'}`, `{kind: 'malformed'}` (opened and never closed, which includes a file that is only `---`) or `{kind: 'block', opening, text, textEnding, closing, body}`. A block carries the pieces that put the document back: `opening + text + textEnding + closing + body` is the original content. `text` is what a YAML parser reads (it is `''` for an empty block); `textEnding` is the line ending of the last line of `text`, or `''` for a block with no lines; `closing` is the closing line with its spaces, tabs and line ending. A caller that rewrites a line of `text` rebuilds the file from the result alone and keeps every other byte.
- The scan visits each line once, so its running time grows linearly with the content, an unclosed block included.

The package's own readers (`parseFrontmatterDocument`, `splitFrontmatter`, the ingest's page parser and the repo-page move) all use it. Each keeps its error texts and its body handling. An empty block is an empty mapping for the document reader and the ingest parser; a block that parses to `null` (whitespace, comments, `null`, `...`) is not a mapping and gets each reader's rule for a non-mapping. The wiki page reader reports an unclosed block as `Invalid frontmatter: missing closing --- delimiter`.

## Target page sources

When the ingest writes the page of the `repo:` target and that page lists no sources (no `sources` key, or an empty list), the page lists `{url, accessed}` with the target's `https://github.com/<owner>/<name>` URL and the date of the ingest's timestamp. When the page on the branch already has an entry for the target, that entry is kept as it is, so a repeat write changes nothing. A page that lists any source is never changed, and neither is a `sources` value that is not a list. When the ingest migrates a page to the target's slug by a trusted node ID, the merged page also gains the target's URL if no entry matches it, and keeps its other entries. No other repo page in the write is stamped, and a write whose target is a page path (the dashboard's case) is never stamped. Whether an entry matches the target uses the privacy gate's URL rule: `https`, host `github.com`, no port, owner and name equal without case, any path after them.

## Gate contract version

`GATE_CONTRACT_VERSION` stays at 1 for the splitter and the reader changes. A bump makes every dashboard save fail until the dashboard ships a release that carries the same version, and the changes here do not need that: no page on `data` changes meaning, the dashboard already has a message for both lint finding kinds, and the dashboard writes with its own installed copy of this package. `dist/gate-contract.json` still changes, because its `sourceTreeHash` follows the source.

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
- Pull requests are squash-merged with `squash_merge_commit_title: PR_TITLE` (`common-settings.yaml`), so the PR title is the commit header the analysis reads. Pick the title type for the release you want.
- A PR that changes only tests, docs other than the README, or other files under `packages/wiki-write-core/` that should not ship needs a non-releasing title (`test:`, `docs:`, `chore:`, `refactor:` or `build(dev):`). A `fix:` or `build:` title there publishes a patch.
- A PR that changes nothing under `packages/wiki-write-core/` does not count toward the release type, whatever its own type. The release runs on every push to `main` and reads every package commit since the last release tag, so such a merge can still publish an earlier package change that has not been released yet.

### Publishing

The `publish` job uses npm trusted publishing (OIDC) from `release-wiki-write-core.yaml` in the `release` environment, and publishes with provenance. There is no npm token. It publishes the package the `build` job staged: the compiled `dist/` and a manifest whose `exports` point at it. The `build` job proves the packed tarball resolves, imports and type-checks every export. The `publish` job runs no repository script. The `build` job exposes a digest of the staged tree (sha256 over the `<sha256>  <path>` listing of every file, in byte order of the path) as a job output, which comes from the runner that built the package and not from the artifact store. The `publish` job recomputes it over what it downloaded and refuses unless the two are equal, before it reads or installs anything. It then checks that the staged manifest is the committed one with `exports` rewritten (each `./src/<name>.ts` becomes `./dist/<name>.js` with `./dist/<name>.d.ts` as its types, and no target has a `.`, `..` or empty segment) and replaces the checkout's `package.json` and `dist/` with the staged files. semantic-release then changes only the manifest's `version` (`npm version`, which the digest does not cover because it is checked first), and `npm publish` packs the same files the `build` job's tarball check proved.

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
