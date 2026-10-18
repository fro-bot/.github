import process from 'node:process'

import {installRenovate, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

/**
 * Installs the Renovate version pinned in `.github/workflows/main.yaml` into `RENOVATE_PREFIX`
 * (default: `$RUNNER_TEMP` or the OS temp dir, under `renovate-<version>`), outside the repo.
 * Idempotent: a matching install is left alone. Prints only the prefix path on stdout.
 */
export async function main(): Promise<void> {
  try {
    const version = await readPinnedVersion(process.cwd())
    const prefix = resolvePrefix(version)
    const outcome = await installRenovate(prefix, version)
    process.stderr.write(`install-renovate: renovate@${version} ${outcome} at ${prefix}\n`)
    process.stdout.write(`${prefix}\n`)
  } catch (error) {
    process.stderr.write(`install-renovate: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
