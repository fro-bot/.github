# Override Floors

The root `package.json` `overrides` map pins 14 floors. This file records the rationale for the six that have one: brace-expansion, fast-uri, qs, source-map-js, undici and zod.

## `brace-expansion`

GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p: recursion DoS; 5.0.12 also fixes GHSA-q2hr-2g5m-vwhr.

Remove this floor only when all parent ranges exclude the affected versions.

## `fast-uri`

GHSA-hrr3-gc8f-f4qj, GHSA-jvvf-x445-j334, GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr and GHSA-333x-w4r6-6crp: URI parsing and normalization flaws (host confusion, scheme spoofing, mailto header injection) in the 4.x line. 4.2.3 is the first release patched against all six.

The installed copy is a transitive of `ajv`, which declares `fast-uri ^3.0.1`, so no parent range admits 4.2.3 and an override is the only way to move it.

Remove this floor only when all parent ranges exclude the affected versions.

## `qs`

GHSA-6pq8-jhm2-2vcw: `qs.stringify` with `arrayFormat: 'comma'` throws an uncaught `TypeError` on array elements carrying a non-callable own `toString` (denial of service). It affects >=6.7.0 <=6.16.0; 6.16.1 is the first patched release.

The installed copy is a transitive of Stryker: `@stryker-mutator/core` depends on `typed-rest-client`, which pins `qs` to the exact version 6.15.1, so a parent bump cannot move it.

Remove this floor when the `typed-rest-client` release in use requires `qs >=6.16.1`.

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
