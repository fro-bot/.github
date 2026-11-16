import type {RepoEntry} from '@fro.bot/wiki-write-core/schemas'
import type {NodeIdResolver} from './private-repo-resolution.ts'
import {Buffer} from 'node:buffer'
// The adapter is a published package with its own copy of the rule; this test keeps that copy equal to
// this package's. It is imported by package name (a relative path would leave this package); the mutated
// module under test, `check-private-leak.ts`, is imported by relative path.
import {checkPrivateLeakWithGitHub, type GitHubPrivateLeakClient} from '@fro.bot/wiki-write-core/private-leak-adapter'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {describe, expect, it, vi} from 'vitest'
import {parse as parseYaml} from 'yaml'
import {runPromotionScan} from './check-private-leak.ts'

vi.mock('@octokit/rest', () => ({Octokit: vi.fn()}))

/**
 * The decision table for one selected registry row, run through the promotion scan and through the
 * published adapter. The two share no code: the adapter carries its own copy of the rule.
 */

const storedName = 'acme-labs/archived-widget'
const liveName = 'other-org/renamed-widget'

type RowKind = 'private' | 'private-no-id' | 'archived-named' | 'archived-named-no-id' | 'archived-redacted'

function rowYaml(kind: RowKind): string {
  const base = {
    owner: 'acme-labs',
    name: 'archived-widget',
    added: '2024-01-01',
    onboarding_status: 'archived',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
  }
  const row = {
    private: {...base, private: true, node_id: 'R_x', onboarding_status: 'onboarded'},
    'private-no-id': {...base, private: true, onboarding_status: 'onboarded'},
    'archived-named': {...base, private: false, node_id: 'R_x'},
    'archived-named-no-id': {...base, private: false},
    'archived-redacted': {...base, private: true, node_id: 'R_x'},
  }[kind]
  return JSON.stringify({version: 1, repos: [row]})
}

function entries(kind: RowKind): RepoEntry[] {
  const parsed: unknown = parseYaml(rowYaml(kind))
  assertReposFile(parsed)
  return parsed.repos
}

type Answer = Awaited<ReturnType<NodeIdResolver>>

function diffNaming(name: string): string {
  return [
    'diff --git a/knowledge/wiki/topics/notes.md b/knowledge/wiki/topics/notes.md',
    '--- a/knowledge/wiki/topics/notes.md',
    '+++ b/knowledge/wiki/topics/notes.md',
    '@@ -1,0 +1 @@',
    `+See ${name} for details.`,
  ].join('\n')
}

/** What the scan says about a diff: `resolution` blocks before scanning; otherwise the scan's verdict. */
async function scanOutcome(kind: RowKind, answer: Answer | undefined, diff: string): Promise<string> {
  const resolver: NodeIdResolver = async () => answer ?? {error: 'error'}
  const result = await runPromotionScan({reposYaml: rowYaml(kind), resolver, diff})
  if ('resolutionFailed' in result) return 'resolution'
  return result.ok ? 'pass' : 'detection'
}

/** The same row and answer as GitHub's GraphQL `nodes` response. A lookup failure is a null node. */
function nodeFor(answer: Answer): unknown {
  if (!('nameWithOwner' in answer)) return null
  const publicNow = answer.visibility === 'PUBLIC'
  return {nameWithOwner: answer.nameWithOwner, isPrivate: !publicNow, visibility: answer.visibility}
}

async function adapterOutcome(kind: RowKind, answer: Answer | undefined, diff: string): Promise<string> {
  const content = Buffer.from(rowYaml(kind), 'utf8').toString('base64')
  const client = {
    rest: {
      repos: {
        getContent: vi.fn(async () => ({data: {type: 'file', sha: 'sha-1', content, encoding: 'base64'}})),
      },
    },
    graphql: vi.fn(async () => {
      if (answer === undefined) throw new Error('no lookup expected')
      return {nodes: [nodeFor(answer)]}
    }),
  } as unknown as GitHubPrivateLeakClient
  try {
    const result = await checkPrivateLeakWithGitHub({
      content: '',
      diff,
      override: {titlePrefixed: false, isOperator: false},
      octokit: client,
    })
    return result.ok ? 'pass' : 'detection'
  } catch {
    return 'resolution'
  }
}

const answerOf = (visibility: unknown): Answer => ({nameWithOwner: liveName, visibility})
const failed: Answer = {error: 'error'}
const lost: Answer = {error: 'access-lost'}

/** [label, row, answer, stored name blocks, live name blocks, blocks as a resolution failure]. */
const table: readonly (readonly [string, RowKind, Answer | undefined, boolean, boolean, boolean])[] = [
  ['private row, PRIVATE', 'private', answerOf('PRIVATE'), false, true, false],
  ['private row, INTERNAL', 'private', answerOf('INTERNAL'), false, true, false],
  ['private row, a failed lookup', 'private', failed, false, false, true],
  ['private row, an access-lost lookup', 'private', lost, false, false, true],
  ['private row, no node ID', 'private-no-id', undefined, false, false, true],
  ['archived named, PUBLIC', 'archived-named', answerOf('PUBLIC'), false, false, false],
  ['archived named, PRIVATE', 'archived-named', answerOf('PRIVATE'), true, true, false],
  ['archived named, INTERNAL', 'archived-named', answerOf('INTERNAL'), true, true, false],
  ['archived named, a missing visibility', 'archived-named', {nameWithOwner: liveName}, true, true, false],
  ['archived named, a null visibility', 'archived-named', answerOf(null), true, true, false],
  ['archived named, a lowercase public', 'archived-named', answerOf('public'), true, true, false],
  ['archived named, a padded PUBLIC', 'archived-named', answerOf('PUBLIC '), true, true, false],
  ['archived named, a failed lookup', 'archived-named', failed, true, false, false],
  ['archived named, an access-lost lookup', 'archived-named', lost, true, false, false],
  ['archived named, no node ID', 'archived-named-no-id', undefined, true, false, false],
  ['archived redacted, PRIVATE', 'archived-redacted', answerOf('PRIVATE'), false, true, false],
  ['archived redacted, a failed lookup', 'archived-redacted', failed, false, false, true],
]

describe('the promotion scan and the published adapter agree on the decision table', () => {
  it.each(table)('%s', async (_label, kind, answer, blocksStored, blocksLive, blocksAsResolution) => {
    expect(entries(kind)).toHaveLength(1)
    for (const [name, blocks] of [
      [storedName, blocksStored],
      [liveName, blocksLive],
    ] as const) {
      const expected = blocksAsResolution ? 'resolution' : blocks ? 'detection' : 'pass'

      expect(await scanOutcome(kind, answer, diffNaming(name))).toBe(expected)
      expect(await adapterOutcome(kind, answer, diffNaming(name))).toBe(expected)
    }
  })

  it.each(['archived-named', 'archived-redacted'] as const)(
    'a %s row that resolves PUBLIC passes the scan, and passes the adapter only when it is not stored private',
    async kind => {
      const diff = diffNaming(liveName)

      expect(await scanOutcome(kind, answerOf('PUBLIC'), diff)).toBe('pass')
      // The published adapter throws for a row stored private that GitHub reports public, as it
      // always has; a named archived row is the case it now clears.
      expect(await adapterOutcome(kind, answerOf('PUBLIC'), diff)).toBe(
        kind === 'archived-named' ? 'pass' : 'resolution',
      )
    },
  )

  it('keeps the stored-private PUBLIC divergence: the scan skips the row, the adapter throws', async () => {
    const diff = diffNaming(liveName)

    expect(await scanOutcome('private', answerOf('PUBLIC'), diff)).toBe('pass')
    expect(await adapterOutcome('private', answerOf('PUBLIC'), diff)).toBe('resolution')
  })
})
