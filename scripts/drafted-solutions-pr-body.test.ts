import {describe, expect, it} from 'vitest'

import {
  hashProposalBody,
  mergeCoverageRows,
  parseCoverageBlock,
  renderPrBody,
  validateCoverageRows,
  type CoverageRow,
} from './drafted-solutions-pr-body.ts'

const SHA = 'a'.repeat(40)

function makeRow(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    issue: 101,
    outcome: 'new-doc',
    targetDoc: 'docs/solutions/best-practices/example-2026-10-09.md',
    sourceSha: SHA,
    evidence: [{kind: 'pr', ref: '#3868'}],
    droppedClaims: [],
    bodyHash: hashProposalBody('proposal body'),
    reason: '',
    ...overrides,
  }
}

const BLOCK_START = '<!-- fro-bot:drafted-solutions-coverage v1'

/** Hand-builds a body around a raw payload so malformed blocks can be tested. */
function bodyWithPayload(payload: string): string {
  return `Summary\n\n${BLOCK_START}\n${payload}\n-->\n`
}

describe('hashProposalBody', () => {
  it('is sha256 hex and stable across CRLF round trips', () => {
    expect(hashProposalBody('a\nb')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashProposalBody('a\r\nb')).toBe(hashProposalBody('a\nb'))
  })

  it('changes when the proposal body is edited', () => {
    expect(hashProposalBody('one')).not.toBe(hashProposalBody('two'))
  })
})

describe('renderPrBody / parseCoverageBlock round trip', () => {
  it('re-parses rendered rows (sorted by issue) exactly', () => {
    const rows = [
      makeRow({issue: 202, outcome: 'extension', evidence: [{kind: 'file', ref: 'scripts/foo.ts'}]}),
      makeRow({
        issue: 101,
        droppedClaims: ['claim that CI took 10 minutes'],
        evidence: [
          {kind: 'pr', ref: '#12'},
          {kind: 'review', ref: 'https://github.com/o/r/pull/12#pullrequestreview-1'},
          {kind: 'ci-run', ref: '123456'},
        ],
      }),
      makeRow({
        issue: 303,
        outcome: 'covered',
        targetDoc: 'docs/solutions/workflow-issues/already-there.md',
        evidence: [],
        reason: 'Existing doc states the same rule.',
      }),
      makeRow({
        issue: 404,
        outcome: 'unverified',
        targetDoc: null,
        evidence: [],
        reason: 'The merged PR no longer exists.',
      }),
    ]

    const body = renderPrBody(rows)
    const parsed = parseCoverageBlock(body, 'existing-pr')

    expect(parsed).toStrictEqual({ok: true, rows: [rows[1], rows[0], rows[2], rows[3]]})
  })

  it('survives a CRLF rewrite of the body', () => {
    const rows = [makeRow()]
    const body = renderPrBody(rows).replaceAll('\n', '\r\n')

    expect(parseCoverageBlock(body, 'existing-pr')).toStrictEqual({ok: true, rows})
  })

  it('re-parses rows whose text contains HTML-comment and table syntax', () => {
    const rows = [
      makeRow({
        reason: '',
        droppedClaims: ['a | b --> c <!-- fro-bot:drafted-solutions-coverage v1 --> <script>', 'line\nbreak'],
        evidence: [{kind: 'file', ref: 'weird|path-->.md'}],
      }),
    ]

    const body = renderPrBody(rows)

    expect(parseCoverageBlock(body, 'existing-pr')).toStrictEqual({ok: true, rows})
    // Only the real block may carry the marker; row text must never forge a second one.
    expect(body.split(BLOCK_START)).toHaveLength(2)
  })

  it('puts the machine block last', () => {
    const body = renderPrBody([makeRow()])

    expect(body.trimEnd().endsWith('-->')).toBe(true)
    expect(body.lastIndexOf(BLOCK_START)).toBeGreaterThan(body.lastIndexOf('Closes #'))
  })
})

describe('renderPrBody content', () => {
  it('renders an evidence table and one sorted Closes line per row', () => {
    const body = renderPrBody([
      makeRow({issue: 30}),
      makeRow({issue: 4, evidence: [{kind: 'pr', ref: '#9'}]}),
      makeRow({issue: 21, outcome: 'covered', evidence: [], reason: 'already documented'}),
    ])

    expect(body).toMatch(/\| Proposal \| Outcome \| Target doc \| Evidence/)
    expect(body).toContain('pr: #9')
    expect(body.match(/^Closes #\d+$/gm)).toStrictEqual(['Closes #4', 'Closes #21', 'Closes #30'])
  })

  it('emits exactly one closing line per issue', () => {
    const body = renderPrBody([makeRow({issue: 7}), makeRow({issue: 8})])

    expect(body.match(/Closes #7\b/g)).toHaveLength(1)
    expect(body.match(/Closes #8\b/g)).toHaveLength(1)
  })

  it('neutralizes markup in table cells', () => {
    const body = renderPrBody([makeRow({droppedClaims: ['<img src=x> | injected']})])

    expect(body).not.toContain('<img')
    expect(body).toContain(String.raw`&lt;img src=x&gt; \| injected`)
  })

  it('renders an empty row set as a valid, re-parseable body with no closing lines', () => {
    const body = renderPrBody([])

    expect(body).not.toContain('Closes #')
    expect(parseCoverageBlock(body, 'existing-pr')).toStrictEqual({ok: true, rows: []})
  })

  it('refuses to render rows that would not re-parse', () => {
    expect(() => renderPrBody([makeRow({evidence: []})])).toThrow(/evidence/)
  })
})

describe('parseCoverageBlock missing block', () => {
  it('parses an empty body as no rows for a newly created PR', () => {
    expect(parseCoverageBlock('', 'new-pr')).toStrictEqual({ok: true, rows: []})
    expect(parseCoverageBlock(null, 'new-pr')).toStrictEqual({ok: true, rows: []})
  })

  it('fails closed on an existing PR body with no block', () => {
    const result = parseCoverageBlock('Just a human-written description', 'existing-pr')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/missing/i)
  })

  it('fails closed on a null existing-PR body', () => {
    expect(parseCoverageBlock(null, 'existing-pr').ok).toBe(false)
  })

  it('still validates a block present in a new-PR body', () => {
    const result = parseCoverageBlock(bodyWithPayload('{"version":1,"rows":"nope"}'), 'new-pr')

    expect(result.ok).toBe(false)
  })
})

describe('parseCoverageBlock fails closed', () => {
  const valid = renderPrBody([makeRow()])

  it('rejects a truncated block (no terminator)', () => {
    const truncated = valid.slice(0, valid.lastIndexOf('-->') - 5)

    const result = parseCoverageBlock(truncated, 'existing-pr')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/truncated|unterminated|malformed/i)
  })

  it('rejects a duplicated block', () => {
    const result = parseCoverageBlock(`${valid}\n${valid}`, 'existing-pr')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/duplicate|more than one|multiple/i)
  })

  it('rejects a block with an unsupported version marker', () => {
    const result = parseCoverageBlock(valid.replace('coverage v1', 'coverage v2'), 'existing-pr')

    expect(result.ok).toBe(false)
  })

  it('rejects invalid JSON', () => {
    const result = parseCoverageBlock(bodyWithPayload('{"version":1,'), 'existing-pr')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/json/i)
  })

  it.each([
    ['payload is an array', '[]'],
    ['wrong version', '{"version":2,"rows":[]}'],
    ['rows is not an array', '{"version":1,"rows":{}}'],
    ['unknown top-level key', '{"version":1,"rows":[],"extra":true}'],
    ['row is not an object', '{"version":1,"rows":[1]}'],
  ])('rejects a schema-invalid payload: %s', (_label: string, payload: string) => {
    expect(parseCoverageBlock(bodyWithPayload(payload), 'existing-pr').ok).toBe(false)
  })
})

function reasonFor(row: unknown): string {
  const result = validateCoverageRows([row])
  if (result.ok) throw new Error('expected validation to fail')
  return result.reason
}

describe('validateCoverageRows', () => {
  it('accepts a minimal valid row', () => {
    expect(validateCoverageRows([makeRow()])).toStrictEqual({ok: true, rows: [makeRow()]})
  })

  it('rejects a new-doc row with no evidence reference', () => {
    expect(reasonFor(makeRow({outcome: 'new-doc', evidence: []}))).toMatch(/evidence/)
  })

  it('rejects an extension row with no evidence reference', () => {
    expect(reasonFor(makeRow({outcome: 'extension', evidence: []}))).toMatch(/evidence/)
  })

  it('allows covered and unverified rows without evidence when they give a reason', () => {
    const covered = makeRow({outcome: 'covered', evidence: [], reason: 'already covered'})
    const unverified = makeRow({
      issue: 102,
      outcome: 'unverified',
      targetDoc: null,
      evidence: [],
      reason: 'no PR found',
    })

    expect(validateCoverageRows([covered, unverified]).ok).toBe(true)
  })

  it('requires a reason on covered and unverified rows', () => {
    expect(reasonFor(makeRow({outcome: 'covered', evidence: [], reason: ''}))).toMatch(/reason/)
    expect(reasonFor(makeRow({outcome: 'unverified', targetDoc: null, reason: '  '}))).toMatch(/reason/)
  })

  it('requires a docs/solutions target doc for new-doc, extension, and covered', () => {
    expect(reasonFor(makeRow({targetDoc: null}))).toMatch(/targetDoc/)
    expect(reasonFor(makeRow({targetDoc: 'docs/plans/x.md'}))).toMatch(/targetDoc/)
    expect(reasonFor(makeRow({targetDoc: 'docs/solutions/x.md'}))).toMatch(/targetDoc/)
    expect(reasonFor(makeRow({outcome: 'covered', targetDoc: null, evidence: [], reason: 'r'}))).toMatch(/targetDoc/)
  })

  it('requires a null target doc for unverified rows', () => {
    expect(
      reasonFor(
        makeRow({outcome: 'unverified', targetDoc: 'docs/solutions/best-practices/x.md', evidence: [], reason: 'r'}),
      ),
    ).toMatch(/targetDoc/)
  })

  it('rejects an unknown outcome', () => {
    expect(reasonFor({...makeRow(), outcome: 'maybe'})).toMatch(/outcome/)
  })

  it.each([
    ['issue is not a positive integer', {issue: 0}],
    ['issue is fractional', {issue: 1.5}],
    ['issue is a string', {issue: '7'}],
    ['sourceSha is not hex', {sourceSha: 'not-a-sha'}],
    ['bodyHash is not sha256 hex', {bodyHash: 'abc123'}],
    ['evidence kind is unknown', {evidence: [{kind: 'blog', ref: 'x'}]}],
    ['evidence ref is empty', {evidence: [{kind: 'pr', ref: ''}]}],
    ['evidence ref has a newline', {evidence: [{kind: 'pr', ref: 'a\nb'}]}],
    ['evidence entry has an extra key', {evidence: [{kind: 'pr', ref: '#1', note: 'x'}]}],
    ['droppedClaims has a non-string', {droppedClaims: [1]}],
    ['droppedClaims has an empty claim', {droppedClaims: ['']}],
    ['reason is not a string', {reason: null}],
  ])('rejects a row where %s', (_label: string, patch: Record<string, unknown>) => {
    expect(validateCoverageRows([{...makeRow(), ...patch}]).ok).toBe(false)
  })

  it('bounds free-text fields so a body cannot grow without limit', () => {
    expect(validateCoverageRows([makeRow({reason: 'x'.repeat(2001)})]).ok).toBe(false)
    expect(validateCoverageRows([makeRow({droppedClaims: ['x'.repeat(1001)]})]).ok).toBe(false)
    expect(validateCoverageRows([makeRow({evidence: [{kind: 'pr', ref: 'x'.repeat(501)}]})]).ok).toBe(false)
  })

  it('rejects a row with an unknown key', () => {
    expect(validateCoverageRows([{...makeRow(), extra: 1}]).ok).toBe(false)
  })

  it('rejects a row missing a required key', () => {
    const incomplete: Partial<CoverageRow> = makeRow()
    delete incomplete.bodyHash

    expect(validateCoverageRows([incomplete]).ok).toBe(false)
  })

  it('rejects duplicate issue numbers', () => {
    const result = validateCoverageRows([makeRow({issue: 5}), makeRow({issue: 5})])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/duplicate/i)
  })

  it('accepts the PR-body parse path for schema-invalid rows with the same rules', () => {
    const payload = JSON.stringify({version: 1, rows: [{...makeRow(), evidence: []}]})

    expect(parseCoverageBlock(bodyWithPayload(payload), 'existing-pr').ok).toBe(false)
  })
})

describe('mergeCoverageRows', () => {
  it('replaces the row for an already-listed proposal and keeps the rest', () => {
    const existing = [makeRow({issue: 1}), makeRow({issue: 2, targetDoc: 'docs/solutions/best-practices/old.md'})]
    const incoming = [makeRow({issue: 2, targetDoc: 'docs/solutions/best-practices/new.md'}), makeRow({issue: 3})]

    const merged = mergeCoverageRows(existing, incoming)

    expect(merged.map(row => row.issue)).toStrictEqual([1, 2, 3])
    expect(merged.find(row => row.issue === 2)?.targetDoc).toBe('docs/solutions/best-practices/new.md')
  })

  it('does not mutate its inputs', () => {
    const existing = [makeRow({issue: 1})]
    const incoming = [makeRow({issue: 1, reason: 'changed'})]

    mergeCoverageRows(existing, incoming)

    expect(existing[0]?.reason).toBe('')
  })

  it('keeps closing lines one per issue and sorted after a replacing merge', () => {
    const merged = mergeCoverageRows(
      [makeRow({issue: 30}), makeRow({issue: 10})],
      [makeRow({issue: 10, evidence: [{kind: 'pr', ref: '#99'}]}), makeRow({issue: 20})],
    )

    const body = renderPrBody(merged)

    expect(body.match(/^Closes #\d+$/gm)).toStrictEqual(['Closes #10', 'Closes #20', 'Closes #30'])
    expect(parseCoverageBlock(body, 'existing-pr')).toStrictEqual({ok: true, rows: merged})
  })

  it('is the identity (sorted) when nothing is incoming', () => {
    const existing = [makeRow({issue: 9}), makeRow({issue: 2})]

    expect(mergeCoverageRows(existing, []).map(row => row.issue)).toStrictEqual([2, 9])
  })
})
