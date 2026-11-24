# Override Floors

The root `package.json` `overrides` map pins 15 floors. This file records the rationale for the seven that have one: brace-expansion, fast-uri, katex, qs, source-map-js, undici and zod. It also describes `accepted-advisories.json`, the reviewed exception list for an advisory that has no fixed version. The list is empty.

## `brace-expansion`

GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p: recursion DoS; 5.0.12 also fixes GHSA-q2hr-2g5m-vwhr.

Remove this floor only when all parent ranges exclude the affected versions.

## `fast-uri`

GHSA-hrr3-gc8f-f4qj, GHSA-jvvf-x445-j334, GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr and GHSA-333x-w4r6-6crp: URI parsing and normalization flaws (host confusion, scheme spoofing, mailto header injection) in the 4.x line. 4.2.3 is the first release patched against all six.

The installed copy is a transitive of `ajv`, which declares `fast-uri ^3.0.1`, so no parent range admits 4.2.3 and an override is the only way to move it.

Remove this floor only when all parent ranges exclude the affected versions.

## `katex`

GHSA-238p-pmpm-9mq7 (low): prototype pollution can bypass KaTeX's trust restrictions. It affects >=0.11.0 <0.18.2; 0.18.2 is the first patched release.

The installed copy is a dev-only transitive of the lint chain: `@eslint/markdown` depends on `mdast-util-math` and `micromark-extension-math`, which declares `katex ^0.16.0`, so no parent range admits a patched release and an override is the only way to move it. The floor is out of the declared range on purpose; the lint gate exercises the parser.

Remove this floor when the `micromark-extension-math` release in use requires `katex >=0.18.2`.

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

GHSA-mrhx-c7xc-m3w5 (high) affects zod <4.6.6; 4.6.6 is the first patched release. `@fro-bot/core` depends on zod directly, pinned at `4.6.7`, which satisfies the `>=4.6.6` floor, for the goke option schemas in `@fro-bot/core/cli`. Stryker brings a second requester: `@stryker-mutator/core` depends on `mutation-server-protocol`, which requires `zod ^4.1.12` (its lock entry asks for 4.5.4, and the floor lifts it). Every requester resolves to the one copy.

The key is `zod@4` so the floor can never apply to a zod 3 copy (no patched 3.x exists). Remove this floor when the Stryker/`mutation-server-protocol` release in use pins `zod >=4.6.6` and core's own pin is at or above it.

## Accepted advisories

`bun run check:override-floors` fails on any high or critical advisory in the locked tree. [`accepted-advisories.json`](../accepted-advisories.json) at the repository root is the one way past it: a temporary exception for an advisory that has no fixed version, so a floor cannot clear it. It is a JSON array; each entry has five fields, all required:

- `package`: the exact package name `bun audit` reports.
- `advisory`: the `bun audit` advisory `id`, a number. The gate matches this, not the GHSA.
- `ghsa`: the GHSA id, for people.
- `reason`: one sentence naming why the advisory is accepted while no fix exists.
- `expires`: the last valid day, `YYYY-MM-DD`, judged in UTC. The expiry day itself still counts; the day after, the entry fails the gate.

An entry skips a blocking advisory only when `package` and `advisory` both match and the entry has not expired; the gate prints one `accepted until <date>: <reason>` line for each skip. Everything else keeps failing: a different advisory id on the same package, the same id on a different package, an unknown severity and unparseable audit output.

The file fails closed. A missing file is an empty list; text that is not JSON, a top level that is not an array, an entry with a missing or mistyped field, an invalid date or a repeated package and advisory fails the gate. An expired entry fails it too, even when the advisory is no longer reported, so a stale entry gets removed. An unexpired entry that matches no reported advisory prints a `notice:` line and does not fail: remove it once the fix has landed.

Do not use the file to silence an advisory that has a fixed version: raise a floor in `overrides` instead. Pick the expiry to force a review, not to push the problem away; renewing an entry takes a new look at the advisory and a reason that still holds.

A withdrawn advisory drops out of `bun audit`, so its entry stops matching and the gate prints the `notice:` line. Remove the entry then too. The picomatch entry for GHSA-fc5q-39xc-vjpf (bun audit id 1247710) was removed this way after GitHub withdrew the advisory on 2026-11-18.
