import {describe, expect, it} from 'vitest'

import {
  buildClassKey,
  buildEdgeChecklistLine,
  buildEdgeFingerprint,
  buildLiveStateSummary,
  buildReportVersionMarker,
  classifySourceType,
  IMPROVEMENT_METRICS_REPORT_LABEL,
  IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR,
  parseEdgeChecklistLine,
  parseLiveStateSummary,
  parseReportVersionMarker,
  recoverReportState,
  REPORT_STATES,
  SOURCE_TYPES,
} from './improvement-metrics-core.ts'

describe('recoverReportState', () => {
  it('accepts every closed-vocabulary state', () => {
    for (const state of REPORT_STATES) {
      expect(recoverReportState(state)).toBe(state)
    }
  })

  it('rejects an out-of-set string, never coercing', () => {
    expect(recoverReportState('unknown-state')).toBeNull()
    expect(recoverReportState('')).toBeNull()
    expect(recoverReportState('Healthy')).toBeNull()
  })
})

describe('buildClassKey', () => {
  it('derives an identical key regardless of frontmatter field order', () => {
    const keyA = buildClassKey({module: 'foo', component: 'bar', problem_type: 'baz'})
    const keyB = buildClassKey({problem_type: 'baz', module: 'foo', component: 'bar'})
    const keyC = buildClassKey({component: 'bar', problem_type: 'baz', module: 'foo'})
    expect(keyA).toBe(keyB)
    expect(keyB).toBe(keyC)
  })

  it('uses a fixed sentinel segment for missing fields, never throws', () => {
    const key = buildClassKey({module: 'foo'})
    expect(key).toContain('unknown')
    expect(() => buildClassKey({})).not.toThrow()
  })

  it('produces different keys for different field values', () => {
    const keyA = buildClassKey({module: 'foo', component: 'bar', problem_type: 'baz'})
    const keyB = buildClassKey({module: 'foo', component: 'bar', problem_type: 'qux'})
    expect(keyA).not.toBe(keyB)
  })

  it('fails fast on control characters or newlines in a field value', () => {
    expect(() => buildClassKey({module: 'foo\nbar', component: 'x', problem_type: 'y'})).toThrow()
    expect(() => buildClassKey({module: 'foo', component: 'x\u0000y', problem_type: 'z'})).toThrow()
  })
})

describe('classifySourceType', () => {
  it('maps labels to exactly one recognized source type', () => {
    expect(classifySourceType(['learning-proposal', 'other'])).toBe('learning-proposal')
    expect(classifySourceType(['pattern-proposal'])).toBe('pattern-proposal')
    expect(classifySourceType(['status-truth'])).toBe('status-truth')
  })

  it('returns a sentinel for labels matching none of the closed set', () => {
    expect(classifySourceType(['random-label'])).toBe('unknown')
    expect(classifySourceType([])).toBe('unknown')
  })

  it('is single-pass deterministic regardless of extra labels', () => {
    for (const type of SOURCE_TYPES) {
      expect(classifySourceType([type, 'extra-label-1', 'extra-label-2'])).toBe(type)
    }
  })
})

describe('buildEdgeFingerprint', () => {
  it('is stable and identical for identical (classKey, eventId)', () => {
    const fpA = buildEdgeFingerprint('class-key-1', 'event-1')
    const fpB = buildEdgeFingerprint('class-key-1', 'event-1')
    expect(fpA).toBe(fpB)
    expect(fpA).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('produces different fingerprints for different inputs', () => {
    const fpA = buildEdgeFingerprint('class-key-1', 'event-1')
    const fpB = buildEdgeFingerprint('class-key-2', 'event-1')
    const fpC = buildEdgeFingerprint('class-key-1', 'event-2')
    expect(fpA).not.toBe(fpB)
    expect(fpA).not.toBe(fpC)
  })

  it('fails fast on control characters or newlines in inputs', () => {
    expect(() => buildEdgeFingerprint('class\nkey', 'event-1')).toThrow()
    expect(() => buildEdgeFingerprint('class-key', 'event\u0000-1')).toThrow()
  })
})

describe('report version marker build/parse', () => {
  it('round-trips build -> parse', () => {
    expect(parseReportVersionMarker(buildReportVersionMarker(1))).toBe(1)
    expect(parseReportVersionMarker(buildReportVersionMarker(42))).toBe(42)
  })

  it('returns null for an absent marker', () => {
    expect(parseReportVersionMarker('no marker here')).toBeNull()
  })

  it('returns null for a malformed marker', () => {
    expect(parseReportVersionMarker('<!-- improvement-metrics:report:version=abc -->')).toBeNull()
    expect(parseReportVersionMarker('<!-- improvement-metrics:report:version=-1 -->')).toBeNull()
  })

  it('fails fast building with a negative or non-integer version', () => {
    expect(() => buildReportVersionMarker(-1)).toThrow()
    expect(() => buildReportVersionMarker(1.5)).toThrow()
  })
})

describe('edge checklist line build/parse', () => {
  it('round-trips build -> parse for checked and unchecked', () => {
    const checkedLine = buildEdgeChecklistLine({fingerprint: 'a'.repeat(64), checked: true})
    const parsedChecked = parseEdgeChecklistLine(checkedLine)
    expect(parsedChecked).toEqual({fingerprint: 'a'.repeat(64), checked: true})

    const uncheckedLine = buildEdgeChecklistLine({fingerprint: 'b'.repeat(64), checked: false})
    const parsedUnchecked = parseEdgeChecklistLine(uncheckedLine)
    expect(parsedUnchecked).toEqual({fingerprint: 'b'.repeat(64), checked: false})
  })

  it('parses [x] as checked true and [ ] as checked false', () => {
    const fp = 'c'.repeat(64)
    expect(parseEdgeChecklistLine(`- [x] <!-- improvement-metrics:edge=${fp} -->`)).toEqual({
      fingerprint: fp,
      checked: true,
    })
    expect(parseEdgeChecklistLine(`- [ ] <!-- improvement-metrics:edge=${fp} -->`)).toEqual({
      fingerprint: fp,
      checked: false,
    })
  })

  it('parses a malformed checkbox as checked: false (fail-safe)', () => {
    const fp = 'd'.repeat(64)
    expect(parseEdgeChecklistLine(`- [?] <!-- improvement-metrics:edge=${fp} -->`)).toEqual({
      fingerprint: fp,
      checked: false,
    })
  })

  it('returns null for a line with no edge marker', () => {
    expect(parseEdgeChecklistLine('- [x] just some text')).toBeNull()
  })
})

describe('live-state summary build/parse', () => {
  it('round-trips build -> parse', () => {
    const summary = buildLiveStateSummary({checked: 2, unchecked: 3})
    expect(summary).toBe('checked-2-unchecked-3')
    expect(parseLiveStateSummary(summary)).toEqual({checked: 2, unchecked: 3})
  })

  it('returns null for malformed input', () => {
    expect(parseLiveStateSummary('not-a-summary')).toBeNull()
    expect(parseLiveStateSummary('checked-a-unchecked-b')).toBeNull()
    expect(parseLiveStateSummary('')).toBeNull()
  })
})

describe('label constant and descriptor', () => {
  it('exports a fixed label and a descriptor row matching its shape', () => {
    expect(IMPROVEMENT_METRICS_REPORT_LABEL).toBe('improvement-metrics-report')
    expect(IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR.name).toBe(IMPROVEMENT_METRICS_REPORT_LABEL)
    expect(typeof IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR.color).toBe('string')
    expect(typeof IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR.description).toBe('string')
  })
})
