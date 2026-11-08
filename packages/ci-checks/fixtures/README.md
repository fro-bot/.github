# Mutation report fixtures

Trimmed real Stryker 10.1.1 JSON reports (`mutation-testing-report-schema` v2) for the tests of the sharded mutation gate (`mutation-merge.test.ts`). They come from a probe run on the 50-entry `mutate` list and 54-entry `testFiles` list that `stryker.config.json` held on 2026-11-07, before the shard modules were added.

| File | What it is |
| --- | --- |
| `mutation-report-baseline.json` | One full run over all 50 `mutate` entries. |
| `mutation-report-two-shard-a.json` | The same tree run as shard A of two, 25 `mutate` entries (`--mutate` list in `config.mutate`). |
| `mutation-report-two-shard-b.json` | Shard B, the other 25 entries. |

Each report keeps its real top-level shape (`schemaVersion`, `thresholds`, `config`, `files`, `testFiles`) and the real file keys, `testFiles` keys, mutator names, statuses and locations. It drops what the classifier never reads: the `source` text (left as an empty string), the replacement text, and all but the first two `Killed` mutants of each file and the first two tests of each test file. Every `Ignored` mutant is kept, with its `statusReason`. Every mutant and test has a real id, and `killedBy` and `coveredBy` hold the first id only.

The classifier verdict of each report against its own `config` is `clean`; the tests change a status in memory when they need a survivor, a timeout or an empty test file.

The probe reports are local only. To rebuild a fixture from a fresh run, keep the same fields: for each `files` entry, the first two `Killed` mutants and every `Ignored` one; for each `testFiles` entry, the first two tests.
