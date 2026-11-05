import {installRenovate, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

export interface InstallRenovateIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/**
 * Installs the Renovate version pinned in `.github/workflows/main.yaml` into `RENOVATE_PREFIX`
 * (default: `$RUNNER_TEMP` or the OS temp dir, under `renovate-<version>`), outside the repo.
 * Idempotent: a matching install is left alone. Prints only the prefix path on stdout and one
 * `install-renovate: renovate@<version> <outcome> at <prefix>` line on stderr. A failure throws, and the CLI
 * prints it as `install-renovate: <message>` with exit 1.
 */
export async function runInstallRenovate(
  rootDir: string,
  env: Readonly<Record<string, string | undefined>>,
  io: InstallRenovateIo,
): Promise<void> {
  const version = await readPinnedVersion(rootDir)
  const prefix = resolvePrefix(version, env)
  const outcome = await installRenovate(prefix, version)
  io.stderr(`install-renovate: renovate@${version} ${outcome} at ${prefix}\n`)
  io.stdout(`${prefix}\n`)
}
