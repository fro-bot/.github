import {resolve} from 'node:path'

/**
 * The root of the checkout this package lives in: three levels above this directory, since the module is
 * `<root>/packages/ci-checks/src/repository-root.ts`. The mutation gate, the Stryker config it reads, the
 * mutation-guards file and the trigger set it builds are all named relative to this root, so a wrong answer
 * here makes the gate read, or delete a report from, the wrong directory. It is a function rather than a
 * module-level constant so every mutant of the path is exercised by a test that calls it.
 *
 * `findRepositoryRoot().endsWith('packages/ci-checks')` is the failure the move from `scripts/` could have
 * caused (one level too few). The tests pin the answer to a directory that holds `stryker.config.json`,
 * `mutation-guards.json` and this package.
 */
export function findRepositoryRoot(): string {
  return resolve(import.meta.dirname, '..', '..', '..')
}
