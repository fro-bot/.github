# Mutation report fixtures

Reduced Stryker 10.1.1 JSON reports for `mutation-merge.test.ts`, cut from a probe run on 2026-11-07 (50 `mutate` entries, 54 `testFiles`, 5,521 mutants).

| File                               | What it is                                               |
| ---------------------------------- | -------------------------------------------------------- |
| `mutation-report-baseline.json`    | One run over six `mutate` entries.                       |
| `mutation-report-two-shard-a.json` | The same tree as shard A of two: three of those entries. |
| `mutation-report-two-shard-b.json` | Shard B: the other three.                                |

Each report keeps the real top-level shape, real file keys, mutator names, statuses, start locations and ids. It drops what the classifier never reads: `source` (an empty string), replacement text, end locations and timings. The three reports hold the same mutants for the same entries. Per file they keep the first two `Killed` mutants and the first two `Ignored` ones with their `statusReason`; per report, four `testFiles` entries with one test each. The six entries all exist in the repository, because the classifier scans their source. The classifier verdict of each report against its own `config` is `clean`; the tests change a status in memory for a survivor, a timeout or an empty test file.

The probe reports are local only. To cut new fixtures, keep the same fields for a few entries that span both shards.
