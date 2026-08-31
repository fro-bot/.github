# `@fro-bot/wiki-write-core`

This package is distributed as unbundled ESM JavaScript with declaration files in the committed `dist/` directory. Node 24 consumers load the JavaScript build directly; no backend transpilation or install-time build step is required. The repository remains private and is not published to npm.

The package is intentionally **ESM-only**. Its exports declare `import` and `types` conditions, but no `require` condition or CommonJS build. CommonJS consumers fail at package resolution by design; the supported boundary is Node 24 ESM.

Consumers should pin the git subdirectory dependency to an immutable commit:

```bash
pnpm add "@fro-bot/wiki-write-core@github:fro-bot/.github#<sha>&path:/packages/wiki-write-core"
```

Update the SHA only after reviewing the package export surface and the full repository gate. CI rebuilds `dist/` in a temporary directory and fails when the committed output differs, so the checked-in artifact cannot silently drift from `src/`.

The package exports `GATE_CONTRACT_VERSION` and `GATE_SOURCE_TREE_HASH` from its root entrypoint. The build embeds a deterministic hash covering every non-test TypeScript file under `src/`, the resolved `tsconfig.build.json` configuration including inherited settings, and canonicalized `exports` and `files` values from `package.json`. Object-key order and `files` array order do not affect the hash. The hash does not cover tests, this README, other manifest fields such as dependencies or version, or runtime dependencies. Because it hashes the _resolved_ compiler configuration, a TypeScript upgrade that changes an inherited default or the `--showConfig` serialization moves the hash with no semantic change to the shipped code; a hash that shifts across a compiler bump is expected and does not by itself indicate gate drift.

`GATE_SOURCE_TREE_HASH` is the automatic drift detector: compare it when you need to know whether the shipped gate inputs changed. `GATE_CONTRACT_VERSION` is a deliberate, human-set marker for an intentional consumer-visible contract break; it is not expected to change for every source edit. Neither value proves that dependencies or the runtime behave identically. Consumers should compare the source hash for ordinary gate-input drift and the contract version when deciding whether an intentional contract migration is required.

The package is the shared source for workflow CLIs and request-time consumers: snapshot lint, wiki ingest/build and commit primitives, privacy-core seams, frontmatter helpers, and rendering-policy validation.

## Finding kinds

`WikiLintFindingKind` includes `correction-eroded` for a blocking active-correction failure and `correction-needs-reconfirmation` for an advisory lifecycle or formatting-only change. Both retain the existing `{kind, path, message, target?}` runtime shape and fingerprint derivation. Consumers with exhaustive matches must handle both kinds.
