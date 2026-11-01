import type {CrossRepoDispatchOctokitClient, GateEntry} from './dispatch-model.ts'
import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit} from '@fro-bot/core/github'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {
  buildTargetClients,
  createTargetClientResolver,
  findRunByCorrelationId,
  findRunConclusion,
  loadOpenGoalIssues,
  loadOtherOpenGoalMarkers,
  parseTargetTokens,
  REQUEST_TIMEOUT_MS,
  type TargetClientResolver,
} from './dispatch-github.ts'
import {mintNonce} from './dispatch-receipts.ts'
import {runDispatch, runTrack, type LabeledEventPayload, type RepoRepository} from './dispatch-run.ts'

async function createOctokitFromEnv(): Promise<CrossRepoDispatchOctokitClient> {
  return createOctokit(process.env.GITHUB_TOKEN, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    missingToken: () => new Error('cross-repo-dispatch: GITHUB_TOKEN is required in the environment'),
  })
}

/** Env var carrying the owner→token JSON map minted per-owner in the workflow. */
const TARGET_TOKENS_ENV_VAR = 'CROSS_REPO_DISPATCH_TARGET_TOKENS'

async function loadRegistryFromDisk(): Promise<GateEntry[]> {
  const {readFile} = await import('node:fs/promises')
  const {parse} = await import('yaml')
  try {
    const raw: unknown = parse(await readFile('metadata/repos.yaml', 'utf8'))
    assertReposFile(raw, 'repos')
    return raw.repos.map(entry => ({
      owner: entry.owner,
      name: entry.name,
      has_fro_bot_workflow: entry.has_fro_bot_workflow,
      private: entry.private,
      cross_repo_receipts: entry.cross_repo_receipts,
    }))
  } catch {
    return []
  }
}

function parseRepository(raw: string | undefined): RepoRepository {
  const [owner, repo] = (raw ?? '').split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new Error('cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format')
  }
  return {owner, repo}
}

async function targetClientResolverFromEnv(): Promise<TargetClientResolver> {
  const tokens = parseTargetTokens(process.env[TARGET_TOKENS_ENV_VAR])
  const clientsByOwner = await buildTargetClients(tokens)
  return createTargetClientResolver(clientsByOwner)
}

export async function runDispatchCli(
  createOctokit: () => Promise<CrossRepoDispatchOctokitClient> = createOctokitFromEnv,
  createTargetClientResolverFn: () => Promise<TargetClientResolver> = targetClientResolverFromEnv,
): Promise<number> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  const approveLabel = process.env.CROSS_REPO_DISPATCH_APPROVE_LABEL ?? 'dispatch-approved'
  const resultPath = process.env.CROSS_REPO_DISPATCH_RESULT_PATH

  if (eventPath === undefined || eventPath === '') {
    process.stderr.write('cross-repo-dispatch: GITHUB_EVENT_PATH is required for dispatch mode\n')
    return 1
  }

  const {readFile} = await import('node:fs/promises')
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as LabeledEventPayload
  const repo = parseRepository(process.env.GITHUB_REPOSITORY)
  const octokit = await createOctokit()
  const {targetClientFor, hasTargetToken} = await createTargetClientResolverFn()

  await runDispatch({
    octokit,
    event,
    repo,
    approveLabel,
    loadRegistry: loadRegistryFromDisk,
    loadOtherOpenGoalMarkers: async () => loadOtherOpenGoalMarkers(octokit, repo, event.issue.number),
    findRunByCorrelationId: async (target, correlationId) =>
      findRunByCorrelationId(targetClientFor(target.owner))(target, correlationId),
    createWorkflowDispatch: async params => {
      await targetClientFor(params.owner).rest.actions.createWorkflowDispatch(params)
    },
    nonceSource: mintNonce,
    resultPath,
    hasTargetToken,
  })
  return 0
}

export async function runTrackCli(
  createOctokit: () => Promise<CrossRepoDispatchOctokitClient> = createOctokitFromEnv,
  createTargetClientResolverFn: () => Promise<TargetClientResolver> = targetClientResolverFromEnv,
): Promise<void> {
  const resultPath = process.env.CROSS_REPO_DISPATCH_RESULT_PATH
  const repo = parseRepository(process.env.GITHUB_REPOSITORY)
  const octokit = await createOctokit()
  const {targetClientFor, hasTargetToken} = await createTargetClientResolverFn()

  await runTrack({
    octokit,
    repo,
    loadOpenGoalIssues: async () => loadOpenGoalIssues(octokit, repo),
    loadRegistry: loadRegistryFromDisk,
    findRunConclusion: async (target, correlationId) =>
      findRunConclusion(targetClientFor(target.owner))(target, correlationId),
    resultPath,
    hasTargetToken,
  })
}

/** The `cross-repo-dispatch.yaml` steps run `dispatch` and `track`; any other mode is rejected by the action. */
const MODE_ERROR = 'cross-repo-dispatch: expected argv[2] to be "dispatch" or "track"\n'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function crossRepoDispatchCli(): CliConfig {
  return {
    name: 'cross-repo-dispatch',
    commands: [
      defineCommand({
        readOnly: false,
        positionals: [{name: 'mode', kind: 'optional'}],
        action: async context => {
          const {mode} = context.positionals
          if (mode === 'dispatch') return runDispatchCli()
          if (mode === 'track') {
            await runTrackCli()
            return 0
          }
          context.stderr(MODE_ERROR)
          return 1
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(crossRepoDispatchCli())
}
