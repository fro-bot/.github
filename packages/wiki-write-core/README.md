# `@fro-bot/wiki-write-core`

This package is distributed as unbundled ESM JavaScript with declaration files in the committed `dist/` directory. Node 24 consumers load the JavaScript build directly; no backend transpilation or install-time build step is required. The repository remains private and is not published to npm.

Consumers should pin the git subdirectory dependency to an immutable commit:

```bash
pnpm add "@fro-bot/wiki-write-core@github:fro-bot/.github#<sha>&path:/packages/wiki-write-core"
```

Update the SHA only after reviewing the package export surface and the full repository gate. CI rebuilds `dist/` in a temporary directory and fails when the committed output differs, so the checked-in artifact cannot silently drift from `src/`.

The package exports `GATE_CONTRACT_VERSION` and `GATE_SOURCE_TREE_HASH` from its root entrypoint. The build embeds the deterministic source-tree hash in the generated runtime artifact so consumers can inspect the exact gate contract they pinned.

The package is the shared source for workflow CLIs and request-time consumers: snapshot lint, wiki ingest/build and commit primitives, privacy-core seams, frontmatter helpers, and rendering-policy validation.

## Finding kinds

`WikiLintFindingKind` includes `correction-eroded` for a blocking active-correction failure and `correction-needs-reconfirmation` for an advisory lifecycle or formatting-only change. Both retain the existing `{kind, path, message, target?}` runtime shape and fingerprint derivation. Consumers with exhaustive matches must handle both kinds.
