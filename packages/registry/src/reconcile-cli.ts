/**
 * The `scripts/reconcile-repos.ts` entrypoint on the goke runner. It takes no arguments: the repository
 * comes from `GITHUB_REPOSITORY` and the three tokens from `FRO_BOT_POLL_PAT`, `RECONCILE_DISCOVERY_TOKEN`
 * and `RECONCILE_WRITER_TOKEN`. The workflow reads the result JSON on stdout. Argv that matches nothing
 * declared is a usage error and reconciles nothing. A `ReconcileError` prints its message and exits 1.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {handleReconcile} from './reconcile-handler.ts'
import {DEFAULT_OWNER, DEFAULT_REPO, ReconcileError} from './reconcile-model.ts'

export function reconcileReposCli(): CliConfig {
  return {
    name: 'reconcile-repos',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          const repository = context.env.GITHUB_REPOSITORY ?? `${DEFAULT_OWNER}/${DEFAULT_REPO}`
          const [owner, repo] = repository.split('/')
          if (owner === undefined || repo === undefined || owner === '' || repo === '') {
            throw new ReconcileError({
              code: 'API_ERROR',
              message: `Invalid GITHUB_REPOSITORY value: "${repository}"`,
              remediation: 'Expected "owner/repo" format. Set GITHUB_REPOSITORY in the workflow.',
            })
          }

          const result = await handleReconcile({owner, repo})
          context.stdout(`${JSON.stringify(result)}\n`)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(reconcileReposCli())
}
