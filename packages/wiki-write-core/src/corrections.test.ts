import {mkdtemp, readFile as readFileReal, rm, writeFile as writeFileReal} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  assertCorrectionsFile,
  CORRECTIONS_PATH,
  CORRECTIONS_VERSION,
  CorrectionStoreError,
  flagCorrectionForReconfirmation,
  getCorrectionLifecycle,
  getCorrectionsForPage,
  isCorrectionsFile,
  normalizeLooseCorrectionRecord,
  parseCorrections,
  parseLooseCorrectionRecord,
  readCorrections,
  reconfirmCorrection,
  recordCorrection,
  retireCorrection,
  serializeCorrections,
  transitionCorrection,
  writeCorrections,
  type CorrectionRecord,
  type CorrectionsFile,
  type LegacyActiveCorrectionRecord,
  type LooseCorrectionRecord,
} from './corrections.ts'
import {buildWikiIngestChanges} from './wiki-ingest.ts'

const emptyCorrections: CorrectionsFile = {version: 1, corrections: []}

const correctionInput = {
  id: 'correction-1',
  pageNodeId: 'R_123',
  span: {text: 'The corrected fact.', start: 0, end: 19},
  serverDerivedAttribution: {actor: 'marcusrbrown', recorded_at: '2026-08-29T12:00:00.000Z'},
}

describe('corrections sidecar', () => {
  it('requires lifecycle-specific fields at compile time', () => {
    // @ts-expect-error Superseded corrections must identify their replacement.
    const missingSupersessionTarget: CorrectionRecord = {
      id: 'superseded',
      page_node_id: 'R_123',
      span: {text: 'The corrected fact.'},
      state: 'superseded',
    }
    // @ts-expect-error Reconfirmation records must explain why operator review is required.
    const missingReconfirmationReason: CorrectionRecord = {
      id: 'reconfirmation',
      page_node_id: 'R_123',
      span: {text: 'The corrected fact.'},
      state: 'needs-reconfirmation',
    }

    expect(missingSupersessionTarget).toBeDefined()
    expect(missingReconfirmationReason).toBeDefined()
  })

  it("assertCorrectionSpan rejects text whose normalized form is empty — corrections-survival.ts relies on this to avoid ''.includes('')", () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: '   \n\t  '}})).toThrow(
      'expected text with non-empty normalized content',
    )
  })

  it('records server-derived attribution and remains readable by survey tooling', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const raw = serializeCorrections(recorded)
    const result = await readCorrections(
      async () => raw,
      () => undefined,
    )

    expect(result.warnings).toEqual([])
    expect(getCorrectionsForPage(result.corrections, 'R_123')).toEqual([
      expect.objectContaining({
        page_node_id: 'R_123',
        attribution: correctionInput.serverDerivedAttribution,
        state: 'active',
      }),
    ])
    expect(raw).not.toContain('knowledge/wiki')
  })

  it('writes the sidecar at the guarded system-owned path', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    let writtenPath = ''
    let writtenContent = ''
    await writeCorrections(recorded, async (path, content) => {
      writtenPath = path
      writtenContent = content
    })

    expect(writtenPath).toBe(CORRECTIONS_PATH)
    expect(parseCorrections(writtenContent)).toEqual(recorded)
  })

  it('supports the correction lifecycle transitions', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const reconfirmation = flagCorrectionForReconfirmation(recorded, correctionInput.id)
    expect(reconfirmation.corrections[0]?.state).toBe('needs-reconfirmation')

    const active = reconfirmCorrection(reconfirmation, correctionInput.id)
    expect(active.corrections[0]?.state).toBe('active')

    const replacement = recordCorrection(active, {
      ...correctionInput,
      id: 'correction-2',
      span: {text: 'The superseding fact.'},
      supersedesId: correctionInput.id,
    })
    expect(replacement.corrections[0]).toEqual(
      expect.objectContaining({state: 'superseded', superseded_by: 'correction-2'}),
    )
    expect(retireCorrection(replacement, 'correction-2').corrections[1]?.state).toBe('retired')
  })

  it('does not preserve reconfirmation reasons on a superseded record', () => {
    const flagged: CorrectionsFile = {
      version: 1,
      corrections: [
        {
          ...correctionInput,
          id: correctionInput.id,
          page_node_id: correctionInput.pageNodeId,
          state: 'needs-reconfirmation',
          reason: 'Upstream changed',
        },
      ],
    }
    const replacement = recordCorrection(flagged, {
      ...correctionInput,
      id: 'replacement',
      span: {text: 'The superseding fact.'},
      supersedesId: correctionInput.id,
    })
    const roundTripped = parseCorrections(serializeCorrections(replacement)).corrections[0]

    expect(roundTripped).toMatchObject({state: 'superseded', superseded_by: 'replacement'})
    expect(roundTripped).not.toHaveProperty('reason')
  })

  it('accepts legacy records while optional rollout fields are absent', () => {
    const legacy = parseCorrections(
      `version: 1\ncorrections:\n  - id: legacy\n    page_node_id: R_123\n    span:\n      text: Legacy fact\n`,
    )

    const legacyRecord = legacy.corrections[0]
    expect(legacyRecord).toEqual({
      id: 'legacy',
      page_node_id: 'R_123',
      span: {text: 'Legacy fact'},
    })
    if (legacyRecord === undefined) throw new Error('expected legacy correction fixture')
    expect(getCorrectionLifecycle(legacyRecord)).toBe('active')
  })

  it('rejects spans that normalize to an empty string at the package boundary', () => {
    expect(() =>
      recordCorrection(emptyCorrections, {
        ...correctionInput,
        span: {text: ' \n\t '},
      }),
    ).toThrow(CorrectionStoreError)
  })

  it('preserves unknown record fields through every lifecycle transition', () => {
    const parsed = parseCorrections(
      `version: 1\ncorrections:\n  - id: legacy\n    page_node_id: R_123\n    span:\n      text: Legacy fact\n    state: active\n    extra_metadata:\n      source: operator\n`,
    )
    const original = parsed.corrections[0]
    if (original === undefined) throw new Error('expected unknown-field fixture')

    const retired = retireCorrection(parsed, 'legacy').corrections[0]
    expect(retired).toMatchObject({extra_metadata: {source: 'operator'}})

    const flagged = flagCorrectionForReconfirmation(parsed, 'legacy')
    const reconfirmed = reconfirmCorrection(flagged, 'legacy').corrections[0]
    expect(reconfirmed).toMatchObject({extra_metadata: {source: 'operator'}})

    const superseded = recordCorrection(parsed, {
      ...correctionInput,
      id: 'replacement',
      pageNodeId: 'R_123',
      span: {text: 'Replacement fact.'},
      supersedesId: 'legacy',
    }).corrections[0]
    expect(superseded).toMatchObject({extra_metadata: {source: 'operator'}})
  })

  it('keeps the legacy normalizer boundary explicit for future tightening', () => {
    const legacy: LooseCorrectionRecord = {
      id: 'legacy',
      page_node_id: 'R_123',
      span: {text: 'Legacy fact'},
    }
    const normalized = normalizeLooseCorrectionRecord(legacy)

    expect(normalized).toEqual(legacy)
    expect(getCorrectionLifecycle(normalized)).toBe('active')

    // @ts-expect-error: removing the legacy union member must force this boundary to be reviewed.
    const strictOnly: Exclude<CorrectionRecord, LegacyActiveCorrectionRecord> = normalized
    expect(strictOnly).toBeDefined()
  })

  it('keeps page corrections attached to node_id across a slug migration', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const migration = buildWikiIngestChanges({
      existingFiles: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/log.md': '# Wiki Log\n',
        'knowledge/wiki/repos/alice--old.md': [
          '---',
          'type: repo',
          'title: alice/old',
          'node_id: R_123',
          'created: 2026-08-28',
          'updated: 2026-08-28',
          '---',
          '',
          'The old page.',
          '',
        ].join('\n'),
      },
      operation: 'manual-edit',
      target: 'repo:alice/new',
      summary: 'Rename repository page.',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      sources: [],
      trackedRepoNodeIds: new Map([['alice--new', 'R_123']]),
      targetNodeId: 'R_123',
      pages: [
        {
          path: 'knowledge/wiki/repos/alice--new.md',
          content: [
            '---',
            'type: repo',
            'title: alice/new',
            'created: 2026-08-29',
            'updated: 2026-08-29',
            '---',
            '',
            'The renamed page.',
            '',
          ].join('\n'),
        },
      ],
    })

    expect(migration.deletedPaths).toContain('knowledge/wiki/repos/alice--old.md')
    expect(migration.files['knowledge/wiki/repos/alice--new.md']).toContain('node_id: R_123')
    expect(getCorrectionsForPage(recorded, 'R_123')).toHaveLength(1)
    expect(getCorrectionsForPage(recorded, 'alice--old')).toEqual([])
  })

  it('fails closed on malformed reads with the existing typed store error', async () => {
    const warn = vi.fn()
    const promise = readCorrections(
      async () => 'version: 1\ncorrections:\n  - id: broken\n    page_node_id: R_123\n    span: nope\n',
      warn,
    )

    await expect(promise).rejects.toMatchObject({name: 'CorrectionStoreError', code: 'INVALID_CORRECTIONS'})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(CORRECTIONS_PATH))
  })

  it('keeps an absent corrections file as a clean no-op', async () => {
    const warn = vi.fn()
    const result = await readCorrections(async () => {
      throw Object.assign(new Error('missing'), {code: 'ENOENT'})
    }, warn)

    expect(result).toEqual({corrections: emptyCorrections, warnings: []})
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails closed when an existing corrections file is empty', async () => {
    const warn = vi.fn()
    await expect(readCorrections(async () => ' \n\t', warn)).rejects.toMatchObject({
      name: 'CorrectionStoreError',
      code: 'INVALID_CORRECTIONS',
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('existing file is empty'))
  })

  it('fails closed on non-ENOENT corrections read failures', async () => {
    const error = Object.assign(new Error('permission denied'), {code: 'EACCES'})

    await expect(readCorrections(async () => Promise.reject(error))).rejects.toMatchObject({
      name: 'CorrectionStoreError',
      code: 'READ_FAILED',
    })
  })

  it('fails hard on malformed writes', async () => {
    const malformed: unknown = {
      version: 1,
      corrections: [{id: 'broken', page_node_id: 'R_123', span: {text: ''}}],
    }

    await expect(writeCorrections(malformed, async () => undefined)).rejects.toMatchObject({
      code: 'INVALID_CORRECTIONS',
    })
  })
})

describe('isCorrectionsFile / assertCorrectionsFile (schema boundary)', () => {
  it('isCorrectionsFile rejects null, arrays, and primitives, and accepts a valid file', () => {
    expect(isCorrectionsFile(null)).toBe(false)
    expect(isCorrectionsFile([])).toBe(false)
    expect(isCorrectionsFile('corrections')).toBe(false)
    expect(isCorrectionsFile(42)).toBe(false)
    expect(isCorrectionsFile(emptyCorrections)).toBe(true)
    expect(isCorrectionsFile(recordCorrection(emptyCorrections, correctionInput))).toBe(true)
  })

  it('isCorrectionsFile rejects a corrections array containing an invalid record', () => {
    expect(isCorrectionsFile({version: 1, corrections: [{bogus: true}]})).toBe(false)
  })

  it('isCorrectionsFile rejects the wrong version even with an otherwise-valid (empty) corrections array', () => {
    expect(isCorrectionsFile({version: 2, corrections: []})).toBe(false)
  })

  it('assertCorrectionsFile rejects a non-object with the default path and exact message', () => {
    expect(() => assertCorrectionsFile(null)).toThrow('corrections: expected object')
  })

  it('assertCorrectionsFile uses a caller-supplied path instead of the default', () => {
    expect(() => assertCorrectionsFile(null, 'input.file')).toThrow('input.file: expected object')
  })

  it('assertCorrectionsFile rejects the wrong version with the exact message', () => {
    expect(() => assertCorrectionsFile({version: 2, corrections: []})).toThrow(
      `corrections.version: expected ${CORRECTIONS_VERSION}`,
    )
  })

  it('assertCorrectionsFile rejects a non-array corrections field with the exact message', () => {
    expect(() => assertCorrectionsFile({version: 1, corrections: 'nope'})).toThrow(
      'corrections.corrections: expected array',
    )
  })

  it('assertCorrectionsFile names the failing index when a later entry is invalid', () => {
    const valid = recordCorrection(emptyCorrections, correctionInput).corrections[0]
    expect(() => assertCorrectionsFile({version: 1, corrections: [valid, {bogus: true}]})).toThrow(
      'corrections.corrections[1].id: expected non-empty string',
    )
  })

  it('assertCorrectionsFile rejects a record whose loose shape parses but whose lifecycle is invalid', () => {
    // id/page_node_id/span all parse; state: 'superseded' with no superseded_by fails normalization,
    // not loose parsing — this is the only way to reach assertCorrectionRecord's normalize call.
    expect(() =>
      assertCorrectionsFile({
        version: 1,
        corrections: [{id: 'a', page_node_id: 'R_1', span: {text: 'x'}, state: 'superseded'}],
      }),
    ).toThrow('superseded corrections require a target')
  })
})

describe('assertCorrectionSpan (via recordCorrection.input.span)', () => {
  it('rejects a non-object span with the exact path and message', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: 5 as unknown as never})).toThrow(
      'input.span: expected object',
    )
  })

  it('rejects a missing/non-string text with the exact path and message', () => {
    expect(() =>
      recordCorrection(emptyCorrections, {...correctionInput, span: {} as unknown as {text: string}}),
    ).toThrow('input.span.text: expected text with non-empty normalized content')
  })

  it.each([
    ['non-integer', 1.5],
    ['non-number', '5' as unknown as number],
    ['negative', -1],
  ])('rejects a %s start with the exact message', (_label, start) => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', start}})).toThrow(
      'input.span.start: expected non-negative integer',
    )
  })

  it('does not require start to be present', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x'}})).not.toThrow()
  })

  it.each([
    ['non-integer', 1.5],
    ['non-number', '5' as unknown as number],
    ['negative', -1],
  ])('rejects a %s end with the exact message', (_label, end) => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', end}})).toThrow(
      'input.span.end: expected non-negative integer',
    )
  })

  it('does not require end to be present', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x'}})).not.toThrow()
  })

  it('accepts a zero end (boundary, not treated as negative)', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', end: 0}})).not.toThrow()
  })

  it('accepts a zero start (boundary, not treated as negative)', () => {
    expect(() =>
      recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', start: 0, end: 1}}),
    ).not.toThrow()
  })

  it('rejects end strictly less than start with the exact message', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', start: 5, end: 3}})).toThrow(
      'input.span: end must be greater than or equal to start',
    )
  })

  it('accepts end equal to start (boundary, not an off-by-one rejection)', () => {
    expect(() =>
      recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', start: 5, end: 5}}),
    ).not.toThrow()
  })

  it('does not compare start/end when only one of the pair is a number', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, span: {text: 'x', start: 5}})).not.toThrow()
    expect(() =>
      recordCorrection(emptyCorrections, {...correctionInput, id: 'other', span: {text: 'x', end: 3}}),
    ).not.toThrow()
  })
})

describe('assertCorrectionAttribution (via recordCorrection.input.serverDerivedAttribution)', () => {
  it('rejects a non-object attribution with the exact message', () => {
    expect(() =>
      recordCorrection(emptyCorrections, {...correctionInput, serverDerivedAttribution: null as unknown as never}),
    ).toThrow('input.serverDerivedAttribution: expected object')
  })

  it.each([
    ['missing', {recorded_at: '2026-01-01T00:00:00.000Z'} as unknown as {actor: string; recorded_at: string}],
    ['empty', {actor: '', recorded_at: '2026-01-01T00:00:00.000Z'}],
    ['non-string', {actor: 5 as unknown as string, recorded_at: '2026-01-01T00:00:00.000Z'}],
  ])('rejects a %s actor with the exact message', (_label, serverDerivedAttribution) => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, serverDerivedAttribution})).toThrow(
      'input.serverDerivedAttribution.actor: expected non-empty server-derived identity',
    )
  })

  it.each([
    ['missing', {actor: 'marcusrbrown'} as unknown as {actor: string; recorded_at: string}],
    ['empty', {actor: 'marcusrbrown', recorded_at: ''}],
    ['non-string', {actor: 'marcusrbrown', recorded_at: 5 as unknown as string}],
  ])('rejects a %s recorded_at with the exact message', (_label, serverDerivedAttribution) => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, serverDerivedAttribution})).toThrow(
      'input.serverDerivedAttribution.recorded_at: expected non-empty timestamp',
    )
  })
})

describe('parseCorrections (top-level shape)', () => {
  it('rejects a non-object document with the exact message', () => {
    expect(() => parseCorrections('- 1\n- 2\n')).toThrow('corrections: expected object')
  })

  it('rejects the wrong version with the exact message', () => {
    expect(() => parseCorrections('version: 2\ncorrections: []\n')).toThrow(
      `corrections.version: expected ${CORRECTIONS_VERSION}`,
    )
  })

  it('rejects a non-array corrections field with the exact message', () => {
    expect(() => parseCorrections('version: 1\ncorrections: nope\n')).toThrow('corrections.corrections: expected array')
  })
})

describe('normalizeLooseCorrectionRecord (lifecycle discrimination)', () => {
  const loose = (overrides: Partial<LooseCorrectionRecord> = {}): LooseCorrectionRecord => ({
    id: 'x',
    page_node_id: 'R_1',
    span: {text: 'fact'},
    ...overrides,
  })

  it('legacy (no state): rejects a stray superseded_by with the exact message', () => {
    expect(() => normalizeLooseCorrectionRecord(loose({superseded_by: 'y'}))).toThrow(
      'corrections.superseded_by: only superseded corrections may have a target',
    )
  })

  it('legacy (no state): returns exactly id/page_node_id/span with no lifecycle keys', () => {
    expect(normalizeLooseCorrectionRecord(loose())).toEqual({id: 'x', page_node_id: 'R_1', span: {text: 'fact'}})
  })

  it("state 'active': rejects a stray superseded_by with the exact message", () => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'active', superseded_by: 'y'}))).toThrow(
      'corrections.superseded_by: only superseded corrections may have a target',
    )
  })

  it("state 'active': rejects a stray reason with the exact message", () => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'active', reason: 'why'}))).toThrow(
      'corrections.reason: only needs-reconfirmation corrections may have a reason',
    )
  })

  it("state 'active': returns exactly id/page_node_id/span/state", () => {
    expect(normalizeLooseCorrectionRecord(loose({state: 'active'}))).toEqual({
      id: 'x',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      state: 'active',
    })
  })

  it("state 'retired': rejects a stray superseded_by with the exact message", () => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'retired', superseded_by: 'y'}))).toThrow(
      'corrections.superseded_by: only superseded corrections may have a target',
    )
  })

  it("state 'retired': rejects a stray reason with the exact message", () => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'retired', reason: 'why'}))).toThrow(
      'corrections.reason: only needs-reconfirmation corrections may have a reason',
    )
  })

  it("state 'retired': returns exactly id/page_node_id/span/state", () => {
    expect(normalizeLooseCorrectionRecord(loose({state: 'retired'}))).toEqual({
      id: 'x',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      state: 'retired',
    })
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])("state 'superseded': rejects a %s superseded_by with the exact message", (_label, supersededBy) => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'superseded', superseded_by: supersededBy}))).toThrow(
      'corrections.superseded_by: superseded corrections require a target',
    )
  })

  it("state 'superseded': rejects a stray reason with the exact message", () => {
    expect(() =>
      normalizeLooseCorrectionRecord(loose({state: 'superseded', superseded_by: 'y', reason: 'why'})),
    ).toThrow('corrections.reason: only needs-reconfirmation corrections may have a reason')
  })

  it("state 'superseded': returns exactly id/page_node_id/span/state/superseded_by", () => {
    expect(normalizeLooseCorrectionRecord(loose({state: 'superseded', superseded_by: 'y'}))).toEqual({
      id: 'x',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      state: 'superseded',
      superseded_by: 'y',
    })
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])("state 'needs-reconfirmation': rejects a %s reason with the exact message", (_label, reason) => {
    expect(() => normalizeLooseCorrectionRecord(loose({state: 'needs-reconfirmation', reason}))).toThrow(
      'corrections.reason: needs-reconfirmation corrections require a reason',
    )
  })

  it("state 'needs-reconfirmation': rejects a stray superseded_by with the exact message", () => {
    expect(() =>
      normalizeLooseCorrectionRecord(loose({state: 'needs-reconfirmation', reason: 'why', superseded_by: 'y'})),
    ).toThrow('corrections.superseded_by: only superseded corrections may have a target')
  })

  it("state 'needs-reconfirmation': returns exactly id/page_node_id/span/state/reason", () => {
    expect(normalizeLooseCorrectionRecord(loose({state: 'needs-reconfirmation', reason: 'why'}))).toEqual({
      id: 'x',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      state: 'needs-reconfirmation',
      reason: 'why',
    })
  })
})

describe('parseLooseCorrectionRecord field validation (via parseCorrections)', () => {
  const yamlWith = (body: string): string => `version: 1\ncorrections:\n${body}`

  it('rejects a non-empty id and non-object entries with the exact message', () => {
    expect(() => parseCorrections(yamlWith('  - 5\n'))).toThrow('corrections.corrections[0]: expected object')
  })

  it.each([
    ['missing', 'page_node_id: R_1\n    span:\n      text: fact\n'],
    ['empty', "id: ''\n    page_node_id: R_1\n    span:\n      text: fact\n"],
  ])('rejects a %s id with the exact message', (_label, body) => {
    expect(() => parseCorrections(yamlWith(`  - ${body}`))).toThrow(
      'corrections.corrections[0].id: expected non-empty string',
    )
  })

  it.each([
    ['missing', 'id: a\n    span:\n      text: fact\n'],
    ['empty', "id: a\n    page_node_id: ''\n    span:\n      text: fact\n"],
  ])('rejects a %s page_node_id with the exact message', (_label, body) => {
    expect(() => parseCorrections(yamlWith(`  - ${body}`))).toThrow(
      'corrections.corrections[0].page_node_id: expected non-empty string',
    )
  })

  it('rejects an invalid state with the exact message', () => {
    expect(() =>
      parseCorrections(yamlWith('  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    state: bogus\n')),
    ).toThrow('corrections.corrections[0].state: expected active, superseded, retired, or needs-reconfirmation')
  })

  it('rejects an empty-string superseded_by at the loose-parse layer with the exact message', () => {
    expect(() =>
      parseCorrections(
        "version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    superseded_by: ''\n",
      ),
    ).toThrow('corrections.corrections[0].superseded_by: expected non-empty string')
  })

  it('rejects an empty-string reason at the loose-parse layer with the exact message', () => {
    expect(() =>
      parseCorrections(
        "version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    reason: ''\n",
      ),
    ).toThrow('corrections.corrections[0].reason: expected non-empty string')
  })

  it('preserves attribution exactly when present and omits it entirely when absent', () => {
    const withAttribution = parseCorrections(
      [
        'version: 1',
        'corrections:',
        '  - id: a',
        '    page_node_id: R_1',
        '    span:',
        '      text: fact',
        '    attribution:',
        '      actor: marcusrbrown',
        "      recorded_at: '2026-01-01T00:00:00.000Z'",
        '',
      ].join('\n'),
    )
    expect(withAttribution.corrections[0]).toEqual({
      id: 'a',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      attribution: {actor: 'marcusrbrown', recorded_at: '2026-01-01T00:00:00.000Z'},
    })

    expect(Object.prototype.hasOwnProperty.call(withAttribution.corrections[0] as object, 'attribution')).toBe(true)

    const withoutAttribution = parseCorrections(
      'version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n',
    )
    expect(withoutAttribution.corrections[0]).toEqual({id: 'a', page_node_id: 'R_1', span: {text: 'fact'}})
    expect(Object.prototype.hasOwnProperty.call(withoutAttribution.corrections[0] as object, 'attribution')).toBe(false)
  })

  it("parseLooseCorrectionRecord: byte-identical to the raw input's key set, all four optional fields present", () => {
    const raw = {
      id: 'a',
      page_node_id: 'R_1',
      span: {text: 'fact'},
      attribution: {actor: 'marcusrbrown', recorded_at: '2026-01-01T00:00:00.000Z'},
      state: 'needs-reconfirmation',
      superseded_by: 'b',
      reason: 'why',
    }
    const parsed = parseLooseCorrectionRecord(raw, 'corrections')

    expect(parsed).toEqual(raw)
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(raw).sort())
    for (const key of ['attribution', 'state', 'superseded_by', 'reason'] as const) {
      expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(true)
    }
  })

  it("parseLooseCorrectionRecord: byte-identical to the raw input's key set, all four optional fields absent", () => {
    const raw = {id: 'a', page_node_id: 'R_1', span: {text: 'fact'}}
    const parsed = parseLooseCorrectionRecord(raw, 'corrections')

    expect(parsed).toEqual(raw)
    expect(Object.keys(parsed).sort()).toEqual(['id', 'page_node_id', 'span'])
    for (const key of ['attribution', 'state', 'superseded_by', 'reason'] as const) {
      expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(false)
    }
  })

  it('prefixes span validation errors with the record path', () => {
    expect(() =>
      parseCorrections('version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: "   "\n'),
    ).toThrow('corrections.corrections[0].span.text: expected text with non-empty normalized content')
  })

  it('validates a present attribution and prefixes the error with the record path', () => {
    expect(() =>
      parseCorrections(
        [
          'version: 1',
          'corrections:',
          '  - id: a',
          '    page_node_id: R_1',
          '    span:',
          '      text: fact',
          '    attribution:',
          "      actor: ''",
          "      recorded_at: '2026-01-01T00:00:00.000Z'",
          '',
        ].join('\n'),
      ),
    ).toThrow('corrections.corrections[0].attribution.actor: expected non-empty server-derived identity')
  })

  it('rejects a non-string, non-empty superseded_by with the exact message', () => {
    expect(() =>
      parseCorrections(
        'version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    superseded_by: 5\n',
      ),
    ).toThrow('corrections.corrections[0].superseded_by: expected non-empty string')
  })

  it('rejects a non-string, non-empty reason with the exact message', () => {
    expect(() =>
      parseCorrections(
        'version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    reason: 5\n',
      ),
    ).toThrow('corrections.corrections[0].reason: expected non-empty string')
  })

  it('names the failing index when loose parsing succeeds but lifecycle normalization rejects the record', () => {
    expect(() =>
      parseCorrections(
        'version: 1\ncorrections:\n  - id: a\n    page_node_id: R_1\n    span:\n      text: fact\n    state: superseded\n',
      ),
    ).toThrow('corrections.corrections[0].superseded_by: superseded corrections require a target')
  })
})

describe('transitionCorrection (legal transition table)', () => {
  const seed = (state?: CorrectionRecord['state'], extra: Record<string, unknown> = {}): CorrectionsFile => ({
    version: 1,
    corrections: [
      {
        id: correctionInput.id,
        page_node_id: correctionInput.pageNodeId,
        span: correctionInput.span,
        ...(state === undefined ? {} : {state}),
        ...extra,
      } as unknown as CorrectionRecord,
    ],
  })

  it('rejects an invalid file before looking at the id (validated up front, not merely by later array use)', () => {
    // corrections is not even an array: skipping the up-front assertCorrectionsFile call would let this
    // reach `.findIndex`, which does not exist on a string, and throw an uncaught TypeError instead of the
    // typed CorrectionStoreError this function promises for every invalid-input path.
    expect(() =>
      transitionCorrection({version: 1, corrections: 'nope'} as unknown as CorrectionsFile, 'x', 'retired'),
    ).toThrow(expect.objectContaining({code: 'INVALID_CORRECTIONS'}))
  })

  it('throws CORRECTION_NOT_FOUND with the exact message, code, and path for a missing id', () => {
    expect(() => transitionCorrection(seed('active'), 'missing', 'retired')).toThrow(
      expect.objectContaining({
        code: 'CORRECTION_NOT_FOUND',
        path: 'corrections',
        message: 'corrections: correction missing was not found',
      }),
    )
  })

  it('rejects any transition out of retired with the exact message, code, and path', () => {
    expect(() => transitionCorrection(seed('retired'), correctionInput.id, 'needs-reconfirmation')).toThrow(
      expect.objectContaining({
        code: 'INVALID_TRANSITION',
        path: 'corrections[0].state',
        message: `corrections: retired correction ${correctionInput.id} cannot transition`,
      }),
    )
  })

  it('rejects any transition out of superseded with the exact message', () => {
    expect(() =>
      transitionCorrection(seed('superseded', {superseded_by: 'y'}), correctionInput.id, 'needs-reconfirmation'),
    ).toThrow(`corrections: superseded correction ${correctionInput.id} cannot transition`)
  })

  it('allows transitioning a legacy (no-state) record to retired without hitting the retired/superseded guard', () => {
    expect(() => transitionCorrection(seed(undefined), correctionInput.id, 'retired')).not.toThrow()
  })

  it('rejects reconfirming an already-active record with the exact message, code, and path', () => {
    expect(() => transitionCorrection(seed('active'), correctionInput.id, 'active')).toThrow(
      expect.objectContaining({
        code: 'INVALID_TRANSITION',
        path: 'corrections[0].state',
        message: `corrections: active correction ${correctionInput.id} is not awaiting reconfirmation`,
      }),
    )
  })

  it('rejects reconfirming a legacy (no-state) record the same way as an explicit active record', () => {
    expect(() => transitionCorrection(seed(undefined), correctionInput.id, 'active')).toThrow(
      `corrections: active correction ${correctionInput.id} is not awaiting reconfirmation`,
    )
  })

  it('allows reconfirming a needs-reconfirmation record', () => {
    const result = transitionCorrection(seed('needs-reconfirmation', {reason: 'why'}), correctionInput.id, 'active')
    expect(result.corrections[0]).toMatchObject({state: 'active'})
  })

  it('does not apply the active-only guard when transitioning to a non-active state', () => {
    expect(() => transitionCorrection(seed('active'), correctionInput.id, 'retired')).not.toThrow()
  })

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
  ])(
    'rejects transitioning to superseded with a %s supersededBy, with the exact message, code, and path',
    (_label, supersededBy) => {
      expect(() => transitionCorrection(seed('active'), correctionInput.id, 'superseded', supersededBy)).toThrow(
        expect.objectContaining({
          code: 'INVALID_TRANSITION',
          path: 'corrections[0].superseded_by',
          message: 'corrections: superseded corrections require supersededBy',
        }),
      )
    },
  )

  it('transitions to superseded and stores the exact supersededBy target', () => {
    const result = transitionCorrection(seed('active'), correctionInput.id, 'superseded', 'replacement-id')
    expect(result.corrections[0]).toMatchObject({state: 'superseded', superseded_by: 'replacement-id'})
  })

  it('defaults the reconfirmation reason when transitioning to needs-reconfirmation with none given', () => {
    const result = transitionCorrection(seed('active'), correctionInput.id, 'needs-reconfirmation')
    expect(result.corrections[0]).toMatchObject({
      state: 'needs-reconfirmation',
      reason: 'Legacy correction requires reconfirmation',
    })
  })

  it('uses a supplied reconfirmation reason verbatim', () => {
    const result = transitionCorrection(
      seed('active'),
      correctionInput.id,
      'needs-reconfirmation',
      undefined,
      'custom reason',
    )
    expect(result.corrections[0]).toMatchObject({state: 'needs-reconfirmation', reason: 'custom reason'})
  })
})

describe('retireCorrection / flagCorrectionForReconfirmation / reconfirmCorrection (direct)', () => {
  it('retireCorrection actually transitions the record, not a no-op', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    expect(retireCorrection(recorded, correctionInput.id).corrections[0]).toMatchObject({state: 'retired'})
  })

  it('flagCorrectionForReconfirmation actually transitions the record, not a no-op', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    expect(flagCorrectionForReconfirmation(recorded, correctionInput.id).corrections[0]).toMatchObject({
      state: 'needs-reconfirmation',
    })
  })

  it('reconfirmCorrection actually transitions the record, not a no-op', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const flagged = flagCorrectionForReconfirmation(recorded, correctionInput.id)
    expect(reconfirmCorrection(flagged, correctionInput.id).corrections[0]).toMatchObject({state: 'active'})
  })
})

describe('recordCorrection (id validation, duplicate/supersede rules, revalidation)', () => {
  it('rejects an invalid file before validating input (validated up front, not merely by later array use)', () => {
    // corrections is not even an array: skipping the up-front assertCorrectionsFile call would let this
    // reach `.some`, which does not exist on a string, and throw an uncaught TypeError instead of the typed
    // CorrectionStoreError this function promises for every invalid-input path.
    expect(() =>
      recordCorrection({version: 1, corrections: 'nope'} as unknown as CorrectionsFile, correctionInput),
    ).toThrow(expect.objectContaining({code: 'INVALID_CORRECTIONS'}))
  })

  it('throws on a duplicate id with the exact message, code, and path', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    expect(() => recordCorrection(recorded, correctionInput)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CORRECTIONS',
        path: 'corrections',
        message: `corrections: duplicate correction id ${correctionInput.id}`,
      }),
    )
  })

  it('does not flag a non-duplicate id as a duplicate', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    expect(() => recordCorrection(recorded, {...correctionInput, id: 'other-id'})).not.toThrow()
  })

  it('throws CORRECTION_NOT_FOUND with the exact message when supersedesId does not exist', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, supersedesId: 'missing'})).toThrow(
      'corrections: correction missing was not found',
    )
  })

  it('rejects superseding a retired correction with the exact message, code, and path', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const retired = retireCorrection(recorded, correctionInput.id)
    expect(() => recordCorrection(retired, {...correctionInput, id: 'new', supersedesId: correctionInput.id})).toThrow(
      expect.objectContaining({
        code: 'INVALID_TRANSITION',
        path: 'corrections',
        message: `corrections: retired correction ${correctionInput.id} cannot be superseded`,
      }),
    )
  })

  it('rejects superseding an already-superseded correction with the exact message', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const superseded = recordCorrection(recorded, {
      ...correctionInput,
      id: 'first-successor',
      span: {text: 'Updated fact.'},
      supersedesId: correctionInput.id,
    })
    expect(() =>
      recordCorrection(superseded, {...correctionInput, id: 'second-successor', supersedesId: correctionInput.id}),
    ).toThrow(`corrections: superseded correction ${correctionInput.id} cannot be superseded`)
  })

  it('allows superseding an active or needs-reconfirmation correction', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    expect(() =>
      recordCorrection(recorded, {...correctionInput, id: 'successor', supersedesId: correctionInput.id}),
    ).not.toThrow()
  })

  it('finds the correction matching supersedesId by id, not merely the first one in the file', () => {
    const first = recordCorrection(emptyCorrections, correctionInput)
    const second = recordCorrection(first, {...correctionInput, id: 'second', span: {text: 'Second fact.'}})
    const firstRetired = retireCorrection(second, correctionInput.id)

    expect(() =>
      recordCorrection(firstRetired, {...correctionInput, id: 'successor', supersedesId: 'second'}),
    ).not.toThrow()
  })

  it('only transitions the superseded record, leaving sibling corrections untouched', () => {
    const first = recordCorrection(emptyCorrections, correctionInput)
    const second = recordCorrection(first, {...correctionInput, id: 'second', span: {text: 'Second fact.'}})
    const result = recordCorrection(second, {...correctionInput, id: 'successor', supersedesId: correctionInput.id})

    const originalRecord = result.corrections.find(c => c.id === correctionInput.id)
    const siblingRecord = result.corrections.find(c => c.id === 'second')
    if (originalRecord === undefined || siblingRecord === undefined) throw new Error('expected both records')

    expect(originalRecord).toMatchObject({state: 'superseded', superseded_by: 'successor'})
    // The sibling must retain its ORIGINAL identity untouched — not merely "be active", which a map that
    // wrongly transforms every record (via a forced-true id-equality check) would also produce by accident.
    expect(siblingRecord).toEqual({
      id: 'second',
      page_node_id: correctionInput.pageNodeId,
      span: {text: 'Second fact.'},
      attribution: correctionInput.serverDerivedAttribution,
      state: 'active',
    })
  })

  it('fails closed when the caller-provided id would make the constructed record invalid', () => {
    expect(() => recordCorrection(emptyCorrections, {...correctionInput, id: ''})).toThrow(CorrectionStoreError)
  })
})

describe('getCorrectionsForPage (input validation)', () => {
  it('rejects an invalid file', () => {
    expect(() =>
      getCorrectionsForPage({version: 1, corrections: [{bogus: true}]} as unknown as CorrectionsFile, 'R_1'),
    ).toThrow(CorrectionStoreError)
  })
})

describe('readCorrections / writeCorrections (I/O seams and encoding)', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map(async dir => rm(dir, {recursive: true, force: true})))
  })

  it('passes utf8 encoding to the injected read implementation', async () => {
    const spy = vi.fn(async () => 'version: 1\ncorrections: []\n')
    await readCorrections(spy, () => undefined, 'some/path.yaml')
    expect(spy).toHaveBeenCalledWith('some/path.yaml', 'utf8')
  })

  it('uses the default read implementation against the real filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corrections-read-'))
    tmpDirs.push(dir)
    const path = join(dir, 'corrections.yaml')
    await writeFileReal(path, 'version: 1\ncorrections: []\n', 'utf8')

    const result = await readCorrections(undefined, undefined, path)
    expect(result).toEqual({corrections: emptyCorrections, warnings: []})
  })

  it('emits the exact READ_FAILED message and warns with it', async () => {
    const error = Object.assign(new Error('permission denied'), {code: 'EACCES'})
    const warn = vi.fn()
    await expect(readCorrections(async () => Promise.reject(error), warn, 'guarded/path.yaml')).rejects.toMatchObject({
      message: 'corrections: unable to read guarded/path.yaml',
    })
    expect(warn).toHaveBeenCalledWith('corrections: unable to read guarded/path.yaml')
  })

  it('distinguishes the empty-file message from the schema-rejection message', async () => {
    await expect(readCorrections(async () => ' \n\t', undefined, 'x.yaml')).rejects.toMatchObject({
      message: 'x.yaml: existing file is empty',
    })
  })

  it('wraps a parse failure with the exact message prefix and the underlying detail', async () => {
    await expect(
      readCorrections(async () => 'version: 1\ncorrections:\n  - id: broken\n', undefined, 'x.yaml'),
    ).rejects.toMatchObject({
      message:
        'x.yaml: unable to parse existing file (corrections.corrections[0].page_node_id: expected non-empty string)',
    })
  })

  it('passes utf8 encoding to the injected write implementation', async () => {
    const spy = vi.fn(async () => undefined)
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    await writeCorrections(recorded, spy, 'some/path.yaml')
    expect(spy).toHaveBeenCalledWith('some/path.yaml', expect.any(String), 'utf8')
  })

  it('uses the default write implementation against the real filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corrections-write-'))
    tmpDirs.push(dir)
    const path = join(dir, 'corrections.yaml')
    const recorded = recordCorrection(emptyCorrections, correctionInput)

    await writeCorrections(recorded, undefined, path)

    expect(parseCorrections(await readFileReal(path, 'utf8'))).toEqual(recorded)
  })

  it('wraps a write failure with the exact WRITE_FAILED code and message', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    await expect(
      writeCorrections(recorded, async () => Promise.reject(new Error('disk full')), 'guarded/path.yaml'),
    ).rejects.toMatchObject({
      code: 'WRITE_FAILED',
      message: 'corrections: unable to write guarded/path.yaml: disk full',
    })
  })

  it('falls back to a fixed detail message when the write implementation rejects with a non-Error', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    await expect(
      // eslint-disable-next-line prefer-promise-reject-errors -- deliberately non-Error, to prove the fallback path
      writeCorrections(recorded, async () => Promise.reject('disk exploded'), 'guarded/path.yaml'),
    ).rejects.toMatchObject({
      code: 'WRITE_FAILED',
      message: 'corrections: unable to write guarded/path.yaml: unknown write failure',
    })
  })
})
