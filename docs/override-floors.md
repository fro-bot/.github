# Override Floors

The root `package.json` `overrides` map pins 14 floors. This file records the rationale for the four that have one: brace-expansion, source-map-js, undici and zod.

## `brace-expansion`

GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p: recursion DoS; 5.0.12 also fixes GHSA-q2hr-2g5m-vwhr.

Remove this floor only when all parent ranges exclude the affected versions.

## `source-map-js`

GHSA-68fv-2mgg-jv7q: indexed source maps can block the event loop in ESLint/Vite tooling.

Remove when upstream consumers require source-map-js >=1.2.2.

## `undici`

GHSA-w293-vg96-wgc3, GHSA-vp8m-p9jh-q5pm, and GHSA-rfgv-xxqx-mfg5 affect <8.10.2.

The floor is >=8.12.2 for [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) (high): excessive content encodings can trigger an unhandled error and denial of service. The affected 8.x range is >=8.0.0 <8.12.2; 8.12.2 is the first patched 8.x release.

Remove this floor only when all parent ranges exclude the affected versions.

## `zod@4`

GHSA-mrhx-c7xc-m3w5 (high) affects zod <4.6.6; 4.6.6 is the only patched release. The installed copy is a transitive of Stryker: `@stryker-mutator/core` depends on `mutation-server-protocol`, which requires `zod ^4.1.12`.

The key is `zod@4` so the floor can never apply to a zod 3 copy (no patched 3.x exists). Remove this floor when the Stryker/`mutation-server-protocol` release in use pins `zod >=4.6.6`.
