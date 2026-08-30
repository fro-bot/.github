# `@fro-bot/wiki-write-core`

This package is shipped as TypeScript source. Node 24 consumes the source using strip-only TypeScript support; there is intentionally no build step. Consumers should pin the git dependency to an immutable commit and update that pin only after reviewing the package export surface and the full repository gate.

The package is the shared source for workflow CLIs and request-time consumers: snapshot lint, wiki ingest/build and commit primitives, privacy-core seams, frontmatter helpers, and rendering-policy validation.

## Finding kinds

`WikiLintFindingKind` includes `correction-eroded` for a blocking active-correction failure and `correction-needs-reconfirmation` for an advisory lifecycle or formatting-only change. Both retain the existing `{kind, path, message, target?}` runtime shape and fingerprint derivation. Consumers with exhaustive matches must handle both kinds.
