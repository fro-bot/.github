# Override Floors

The root `package.json` `overrides` map pins 13 floors. This file records the rationale for the three that have one: brace-expansion, source-map-js and undici.

## `brace-expansion`

GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p: recursion DoS; 5.0.12 also fixes GHSA-q2hr-2g5m-vwhr.

Remove this floor only when all parent ranges exclude the affected versions.

## `source-map-js`

GHSA-68fv-2mgg-jv7q: indexed source maps can block the event loop in ESLint/Vite tooling.

Remove when upstream consumers require source-map-js >=1.2.2.

## `undici`

GHSA-w293-vg96-wgc3, GHSA-vp8m-p9jh-q5pm, and GHSA-rfgv-xxqx-mfg5 affect <8.10.2.

Remove this floor only when all parent ranges exclude the affected versions.
