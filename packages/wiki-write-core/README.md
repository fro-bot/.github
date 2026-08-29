# `@fro-bot/wiki-write-core`

This package is shipped as TypeScript source. Node 24 consumes the source using strip-only TypeScript support; there is intentionally no build step. Consumers should pin the git dependency to an immutable commit and update that pin only after reviewing the package export surface and the full repository gate.

The package is the shared source for workflow CLIs and request-time consumers: snapshot lint, wiki ingest/build and commit primitives, privacy-core seams, frontmatter helpers, and rendering-policy validation.
