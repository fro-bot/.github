/**
 * The linear-time matchers must return exactly what the original patterns return. The references
 * below are those patterns, unchanged, run with `matchAll`. Inputs come from a seeded generator of
 * fragments chosen to hit the edges of each grammar: runs of word characters, dots and dashes, the
 * `issue` and `release` and `plan` prefixes, double slashes, trailing slashes, characters that the
 * `iu` flags fold into `\w` (U+017F and U+212A), whitespace, and the states.
 */

import type {MarkerData} from './rollout-tracker-snapshot.ts'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  extractStatusTruthClaimsFromText,
  matchCrossRepoPrIssueClaims,
  matchCrossRepoRefs,
  matchCrossRepoReleaseClaims,
  matchPlanStatusClaims,
} from './detect-extract.ts'
import {CLAIM_KIND_DEFINITIONS} from './report-model.ts'
import {extractPreviousMarker} from './rollout-tracker-snapshot.ts'

const REF = /\b[\w.-]+\/[\w.-]+#(\d+)\b/gu
const PR_ISSUE = /\b(?:(issue)\s+)?([\w.-]+)\/([\w.-]+)#(\d+)\s+is\s+(merged|open|closed)\b/giu
const RELEASE = /\brelease\s+([\w.-]+)\/([\w.-]+)@([\w.-]+)\s+is\s+(published|draft|unpublished)\b/giu
const PLAN_STATUS =
  /\b(?:plan\s+)?(docs\/plans\/(?:[\w-]+\/)*[\w-]+\.md)\s+is\s+(active|complete|draft|cancelled|superseded)\b/iu

const planStatusDefinition = CLAIM_KIND_DEFINITIONS.find(definition => definition.kind === 'plan-status')

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = Math.trunc(state + 0x6d2b79f5)
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FRAGMENTS = [
  'a',
  'b',
  'x1',
  'agent',
  'owner',
  'repo',
  'v1.2',
  '.',
  '..',
  '-',
  '_',
  '/',
  '//',
  '#',
  '@',
  '12',
  '7',
  '0',
  ' ',
  '  ',
  '\n',
  '\t',
  ' is ',
  ' is',
  'is ',
  'open',
  'closed',
  'merged',
  'published',
  'draft',
  'unpublished',
  'active',
  'complete',
  'cancelled',
  'superseded',
  'issue ',
  'issue\n',
  'issue',
  'Issue ',
  'ISSUE ',
  'release ',
  'Release ',
  'release',
  'plan ',
  'plan',
  'Plan\t',
  'docs/plans/',
  'DOCS/Plans/',
  'docs/plans/a/',
  'docs/plans/',
  '.md',
  '.MD',
  '.md ',
  'x.md',
  '\u017F',
  '\u212A',
  'ſ',
  'é',
  '😀',
  ':',
  '!',
  '`',
  '(',
  ')',
  '<!-- ',
  '-->',
  'gateway-rollout-tracker:',
  '{"hash":"h"}',
  '<!--',
  'PR #',
  'rollout tracker #',
]

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T
}

const TOKENS = [
  'agent',
  'a',
  'x-y',
  'v1.2',
  'a.b',
  '.a',
  'a.',
  '-a',
  'a-',
  '_',
  'owner',
  'repo.js',
  '\u017F',
  '\u212A',
  'A1',
]
const STATES = [
  'open',
  'closed',
  'merged',
  'published',
  'draft',
  'unpublished',
  'active',
  'complete',
  'cancelled',
  'superseded',
  'Open',
  'DRAFT',
  'opened',
  'completed',
]
const GLUE = [' ', '  ', '\n', '', '.', '-', '/', ' , ', '\t']
const PREFIXES = [
  '',
  '',
  'issue ',
  'Issue\n',
  'x.issue ',
  '-issue ',
  'plan ',
  'xplan ',
  '-plan ',
  'release ',
  'Release  ',
  'xrelease ',
  '.release ',
]
const SEGMENTS = ['a', 'b-c', 'x_1', 'docs', 'plans', 'a', 'b', 'A', '', '.']

function clause(random: () => number): string {
  const owner = pick(random, TOKENS)
  const repo = pick(random, TOKENS)
  const number = pick(random, ['1', '12', '007', '1', '12', '4', '', 'x', '3a'])
  const state = pick(random, STATES)
  const isWord = pick(random, [' is ', ' is ', ' is ', ' is ', ' is\n', ' Is  ', 'is', ' was '])
  const kind = [0, 1, 2, 2, 3][Math.floor(random() * 5)]
  if (kind === 0) return `${pick(random, PREFIXES)}${owner}/${repo}#${number}${isWord}${state}`
  if (kind === 1)
    return `${random() < 0.7 ? 'release ' : pick(random, PREFIXES)}${owner}/${repo}@${pick(random, TOKENS)}${isWord}${state}`
  if (kind === 2) {
    const depth = Math.floor(random() * 4)
    let path = pick(random, [
      'docs/plans/',
      'docs/plans/',
      'docs/plans/',
      'docs/plans/',
      'DOCS/Plans/',
      'doc\u017F/plan\u017F/',
      'docs/plan/',
    ])
    for (let index = 0; index < depth; index += 1)
      path += `${pick(random, SEGMENTS)}${pick(random, ['/', '/', '/', '//', ''])}`
    return `${pick(random, PREFIXES)}${path}${pick(random, ['x', 'a-b', 'x', 'y1', ''])}${pick(random, ['.md', '.md', '.md', '.md', '.MD', '.mdx', '.md/'])}${isWord}${state}`
  }
  return `${pick(random, TOKENS)}/${pick(random, TOKENS)}#${number}`
}

function corrupt(random: () => number, text: string): string {
  if (text.length === 0 || random() < 0.6) return text
  const at = Math.floor(random() * text.length)
  const piece = pick(random, FRAGMENTS)
  const mode = Math.floor(random() * 3)
  if (mode === 0) return text.slice(0, at) + text.slice(at + 1)
  if (mode === 1) return text.slice(0, at) + piece + text.slice(at)
  return text.slice(0, at) + piece + text.slice(at + 1)
}

function generate(random: () => number, maxFragments: number): string {
  if (random() < 0.75) {
    const count = 1 + Math.floor(random() * 5)
    let text = ''
    for (let index = 0; index < count; index += 1) text += corrupt(random, clause(random)) + pick(random, GLUE)
    return text
  }
  const count = 1 + Math.floor(random() * maxFragments)
  let text = ''
  for (let index = 0; index < count; index += 1) text += pick(random, FRAGMENTS)
  return text
}

const asRows = (matches: Iterable<RegExpMatchArray>) => [...matches].map(match => [match.index, ...match])

describe('the linear matchers equal the original patterns', () => {
  const SEEDS = 12
  const PER_SEED = 1_500

  const subjects: readonly (readonly [string, RegExp, (text: string) => RegExpExecArray[]])[] = [
    ['CROSS_REPO_REF_PATTERN', REF, matchCrossRepoRefs],
    ['CROSS_REPO_PR_ISSUE_PATTERN', PR_ISSUE, matchCrossRepoPrIssueClaims],
    ['CROSS_REPO_RELEASE_PATTERN', RELEASE, matchCrossRepoReleaseClaims],
    [
      'the plan-status pattern',
      new RegExp(PLAN_STATUS.source, 'giu'),
      text => matchPlanStatusClaims(text, PLAN_STATUS),
    ],
  ]

  it('uses the plan-status pattern that the grammar table holds', () => {
    expect(planStatusDefinition?.pattern.source).toBe(PLAN_STATUS.source)
    expect(planStatusDefinition?.pattern.flags).toBe(PLAN_STATUS.flags)
  })

  it.each(subjects)(
    '%s: the generator reaches the pattern (a guard on the differential itself)',
    (_name, reference) => {
      const random = mulberry32(99)
      let matched = 0
      for (let round = 0; round < 3_000; round += 1) {
        if (generate(random, 40).match(new RegExp(reference.source, reference.flags)) !== null) matched += 1
      }
      expect(matched).toBeGreaterThan(100)
    },
  )

  it.each(subjects)('%s: seeded random text, index, groups and order', (_name, reference, linear) => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = mulberry32(seed)
      for (let round = 0; round < PER_SEED; round += 1) {
        const text = generate(random, 40)
        expect(asRows(linear(text)), `seed ${seed} round ${round}: ${JSON.stringify(text)}`).toEqual(
          asRows(text.matchAll(new RegExp(reference.source, reference.flags))),
        )
      }
    }
  })

  const EDGES = [
    '',
    'a/b#1',
    'a/b#1.c/d#2',
    '.a/b#1',
    '-a/b#1',
    'x.issue a/b#1 is open',
    'x.release a/b@c is draft',
    'issue a/b#1 is open',
    'issue\n\n a/b#1 is closed',
    'issue/a#1 is open',
    'ISSUE A/B#1 IS OPEN',
    'a/b#1 is merged.c/d#2 is open',
    'a/b#1 is mergedc/d#2 is open',
    'a/b#12a',
    'a/b#12-',
    'plan docs/plans/a.md is active',
    'xplan docs/plans/a.md is active',
    '-plan docs/plans/a.md is active',
    'plan  \n docs/plans/a/b-c.md is draft',
    'docs/plans//a.md is active',
    'docs/plans/a//b.md is active',
    'docs/plans/docs/plans//b.md is active',
    'docs/plans/docs/plans/b.md is active',
    'docs/plans/a/.md is active',
    'docs/plans/.md is active',
    'docs/plans/a.md is active-docs/plans/b.md is draft',
    'docs/plans/a.md is activedocs/plans/b.md is draft',
    'xdocs/plans/a.md is active',
    '-docs/plans/a.md is active',
    'DOCS/PLANS/A.MD IS ACTIVE',
    'doc\u017F/plan\u017F/a.md is active',
    '\u017F/\u212A#1 is open',
    'a/b#1 is open'.repeat(3),
  ]

  it.each(subjects)('%s: hand-picked edges', (_name, reference, linear) => {
    for (const text of EDGES) {
      expect(asRows(linear(text)), JSON.stringify(text)).toEqual(
        asRows(text.matchAll(new RegExp(reference.source, reference.flags))),
      )
    }
  })

  it('extractStatusTruthClaimsFromText keeps its claims on generated documents', () => {
    const referenceClaims = (text: string) =>
      [...text.matchAll(new RegExp(PLAN_STATUS.source, 'giu'))].map(match => [match[1], match[2]?.toLowerCase()])
    for (let seed = 1; seed <= 4; seed += 1) {
      const random = mulberry32(seed + 100)
      for (let round = 0; round < 800; round += 1) {
        const text = generate(random, 30)
        const planClaims = extractStatusTruthClaimsFromText({path: 'docs/x.md', text})
          .filter(claim => claim.kind === 'plan-status')
          .map(claim => [claim.sourceRef, claim.claimedState])
        expect(planClaims, JSON.stringify(text)).toEqual(referenceClaims(text))
      }
    }
  })
})

/** The implementation before the search was cut at the last `-->`: the same pattern over the whole body. */
function reference(body: string): MarkerData | null {
  if (!body) return null
  const markerRegex = /<!--\s*gateway-rollout-tracker:([\s\S]*?)-->/g
  let lastMatch: RegExpExecArray | null = null
  for (;;) {
    const match = markerRegex.exec(body)
    if (match === null) break
    lastMatch = match
  }
  const jsonStr = lastMatch?.[1]
  if (jsonStr === undefined) return null
  try {
    const parsed: unknown = JSON.parse(jsonStr)
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as {hash?: unknown}).hash !== 'string')
      return null
    const record = parsed as {hash: string; snapshot?: unknown; last_mention_id?: unknown}
    const lastMentionId = record.last_mention_id
    return {
      hash: record.hash,
      snapshot: record.snapshot,
      last_mention_id:
        typeof lastMentionId === 'number' && Number.isSafeInteger(lastMentionId) && lastMentionId >= 0
          ? lastMentionId
          : null,
    }
  } catch {
    return null
  }
}

describe('extractPreviousMarker equals the original implementation', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns what the original returns on seeded random text', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const random = mulberry32(seed + 1_000)
      for (let round = 0; round < 1_500; round += 1) {
        const text = generate(random, 30)
        expect(extractPreviousMarker(text), JSON.stringify(text)).toEqual(reference(text))
      }
    }
  })

  it('returns what the original returns on bodies built from real markers', () => {
    const marker = (hash: string) => `<!-- gateway-rollout-tracker:{"hash":"${hash}","last_mention_id":3} -->`
    const pieces = [
      marker('h1'),
      marker('h2'),
      '<!-- gateway-rollout-tracker:',
      '-->',
      ' ',
      '\n',
      'text',
      '<!--',
      '--->',
      '{"hash":"x"}',
    ]
    for (let seed = 1; seed <= 6; seed += 1) {
      const random = mulberry32(seed + 2_000)
      for (let round = 0; round < 1_000; round += 1) {
        const count = 1 + Math.floor(random() * 8)
        let text = ''
        for (let index = 0; index < count; index += 1) text += pieces[Math.floor(random() * pieces.length)] ?? ''
        expect(extractPreviousMarker(text), JSON.stringify(text)).toEqual(reference(text))
      }
    }
  })

  it.each([
    ['one closed marker', '<!-- gateway-rollout-tracker:{"hash":"h1"} -->', 'h1'],
    [
      'the last of two markers',
      '<!-- gateway-rollout-tracker:{"hash":"h1"} --> x <!-- gateway-rollout-tracker:{"hash":"h2"} -->',
      'h2',
    ],
    [
      'a prefix after the last close is ignored',
      '<!-- gateway-rollout-tracker:{"hash":"h1"} --><!-- gateway-rollout-tracker:{"hash":"h2"}',
      'h1',
    ],
    ['no close at all', '<!-- gateway-rollout-tracker:{"hash":"h1"}', null],
    ['an empty body', '', null],
  ])('%s', (_name, text, hash) => {
    expect(extractPreviousMarker(text)?.hash ?? null).toBe(hash)
    expect(extractPreviousMarker(text)?.hash ?? null).toBe(reference(text)?.hash ?? null)
  })
})
