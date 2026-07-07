import type {
  CrossRepoDispatchOctokitClient,
  CrossRepoResult,
  DispatchItem,
  DispatchTarget,
  GateEntry,
  GoalState,
  LabeledEventPayload,
  OpenGoalIssue,
  RunDispatchResult,
  TrackerComment,
} from './cross-repo-dispatch.ts'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'

import {
  buildMarkerComment,
  buildResultMarker,
  classifyReceiptCapability,
  computeApprovalFingerprint,
  createTargetClientResolver,
  CROSS_REPO_GOAL_LABEL,
  extractItemPrompts,
  extractMarker,
  findRunByCorrelationId,
  findRunConclusion,
  gateTarget,
  gateTargetForAccountableDispatch,
  hashNonce,
  loadOpenGoalIssues,
  loadOtherOpenGoalMarkers,
  MARKER_PREFIX,
  MAX_ITEMS_PER_GOAL,
  parseDecomposition,
  parseResult,
  parseTargetTokens,
  planDispatch,
  planSnapshot,
  RECEIPT_BACKFILL_CANDIDATES,
  RECEIPT_SLA_MS,
  repairJsonStringEscapes,
  REQUIRED_APPROVER,
  resolveReceipts,
  runDispatch,
  runDispatchCli,
  runTrack,
  runTrackCli,
  selectStateMarker,
  serializeMarker,
  TARGET_WORKFLOW_ID,
} from './cross-repo-dispatch.ts'

function makeItem(overrides: Partial<DispatchItem> = {}): DispatchItem {
  return {
    id: 'item-1',
    target: {owner: 'fro-bot', name: 'agent'},
    promptHash: 'abc123abc123abcd',
    status: 'pending',
    ...overrides,
  }
}

function makeState(overrides: Partial<GoalState> = {}): GoalState {
  return {
    goal: 'goal-1',
    items: [makeItem()],
    markerHash: '',
    ...overrides,
  }
}

describe('marker round-trip', () => {
  it('serializes and extracts the same state', () => {
    const state = makeState()
    const comment = buildMarkerComment(state)
    expect(comment.startsWith(`<!-- ${MARKER_PREFIX}`)).toBe(true)
    const extracted = extractMarker(comment)
    expect(extracted).not.toBeNull()
    expect(extracted?.state.goal).toBe('goal-1')
    expect(extracted?.state.items).toHaveLength(1)
  })

  it('returns null for absent marker', () => {
    expect(extractMarker('just a regular comment')).toBeNull()
  })

  it('returns null for malformed marker JSON', () => {
    expect(extractMarker(`<!-- ${MARKER_PREFIX}{not json} -->`)).toBeNull()
  })

  it('takes the last marker when multiple are present', () => {
    const first = serializeMarker(makeState({goal: 'first'}))
    const second = serializeMarker(makeState({goal: 'second'}))
    const body = `<!-- ${MARKER_PREFIX}${JSON.stringify(first)} -->\n<!-- ${MARKER_PREFIX}${JSON.stringify(second)} -->`
    expect(extractMarker(body)?.state.goal).toBe('second')
  })
})

describe('selectStateMarker author filter', () => {
  it('accepts fro-bot and fro-bot[bot]', () => {
    const state = makeState()
    const body = buildMarkerComment(state)
    for (const login of ['fro-bot', 'fro-bot[bot]']) {
      const comments: TrackerComment[] = [{author: {login}, body}]
      expect(selectStateMarker(comments)?.state.goal).toBe('goal-1')
    }
  })

  it('rejects a spoofed marker from marcusrbrown', () => {
    const state = makeState({goal: 'spoofed'})
    const body = buildMarkerComment(state)
    const comments: TrackerComment[] = [{author: {login: 'marcusrbrown'}, body}]
    expect(selectStateMarker(comments)).toBeNull()
  })

  it('rejects any other non-bot author', () => {
    const state = makeState({goal: 'spoofed'})
    const body = buildMarkerComment(state)
    const comments: TrackerComment[] = [{author: {login: 'random-user'}, body}]
    expect(selectStateMarker(comments)).toBeNull()
  })

  it('picks the latest bot marker via findLast semantics', () => {
    const older = buildMarkerComment(makeState({goal: 'older'}))
    const newer = buildMarkerComment(makeState({goal: 'newer'}))
    const comments: TrackerComment[] = [
      {author: {login: 'fro-bot'}, body: older},
      {author: {login: 'marcusrbrown'}, body: buildMarkerComment(makeState({goal: 'ignored'}))},
      {author: {login: 'fro-bot[bot]'}, body: newer},
    ]
    expect(selectStateMarker(comments)?.state.goal).toBe('newer')
  })
})

describe('parseDecomposition', () => {
  it('parses a valid checklist', () => {
    const result = parseDecomposition('- [ ] fro-bot/agent: do the thing\n- [x] marcusrbrown/dotfiles: fix the config')
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]?.target).toEqual({owner: 'fro-bot', name: 'agent'})
    expect(result.items[0]?.status).toBe('pending')
  })

  it('returns no-items for prose with no checklist-shaped lines (tolerant parser skips prose)', () => {
    const result = parseDecomposition('this is not a checklist line')
    expect(result.ok).toBe(false)
    expect(result.items).toHaveLength(0)
    expect(result.reason).toBe('no-items')
    expect(result.error).toBeDefined()
  })

  it('returns malformed for a task-list-shaped line that fails the strict grammar', () => {
    const result = parseDecomposition('- [ ] not-a-valid-target-format do the thing')
    expect(result.ok).toBe(false)
    expect(result.items).toHaveLength(0)
    expect(result.reason).toBe('malformed')
  })

  it('tolerates surrounding prose, headers, and an HTML details block around a valid checklist', () => {
    const body = [
      'This is a clean cross-repo goal: confirm each target README opens with an H1.',
      '',
      '## Proposed per-repo work items',
      '',
      '- [ ] fro-bot/agent: do the thing',
      '- [x] marcusrbrown/dotfiles: fix the config',
      '',
      '---',
      '',
      '<details>',
      '<summary>Run Summary</summary>',
      '',
      '| Field | Value |',
      '|-------|-------|',
      '| Event | issues |',
      '',
      '</details>',
    ].join('\n')
    const result = parseDecomposition(body)
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]?.id).toBe('item-1')
    expect(result.items[1]?.id).toBe('item-2')
  })

  it('prefers the delimited region when present, ignoring prose-adjacent noise outside it', () => {
    const body = [
      'Prose intro that is not part of the checklist.',
      '<!-- fro-bot:cross-repo-items:start -->',
      '- [ ] fro-bot/agent: do the thing',
      '<!-- fro-bot:cross-repo-items:end -->',
      'Prose footer, also not part of the checklist.',
    ].join('\n')
    const result = parseDecomposition(body)
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.target).toEqual({owner: 'fro-bot', name: 'agent'})
  })

  it('assigns ids by ordinal among collected items, not source line index', () => {
    const body = [
      'Some prose above the first item.',
      '- [ ] fro-bot/agent: first item',
      'Some prose between items.',
      '- [ ] fro-bot/wiki: second item',
    ].join('\n')
    const result = parseDecomposition(body)
    expect(result.ok).toBe(true)
    expect(result.items[0]?.id).toBe('item-1')
    expect(result.items[1]?.id).toBe('item-2')
  })

  it('returns a parse error on empty body', () => {
    const result = parseDecomposition('')
    expect(result.ok).toBe(false)
    expect(result.items).toHaveLength(0)
  })

  it('rejects when item count exceeds the cap', () => {
    const lines = Array.from({length: MAX_ITEMS_PER_GOAL + 1}, (_, i) => `- [ ] fro-bot/repo-${i}: do thing ${i}`)
    const result = parseDecomposition(lines.join('\n'))
    expect(result.ok).toBe(false)
    expect(result.items).toHaveLength(0)
  })

  it('accepts exactly the cap', () => {
    const lines = Array.from({length: MAX_ITEMS_PER_GOAL}, (_, i) => `- [ ] fro-bot/repo-${i}: do thing ${i}`)
    const result = parseDecomposition(lines.join('\n'))
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(MAX_ITEMS_PER_GOAL)
  })

  it('never lets free text into item fields on partial match failure', () => {
    const result = parseDecomposition('- [ ] not-a-valid-target-format do the thing')
    expect(result.ok).toBe(false)
    expect(result.items).toHaveLength(0)
  })

  it('accepts `*` and `+` task-list bullets identically to `-`', () => {
    const body = [
      'Some prose introducing the plan.',
      '* [ ] marcusrbrown/sparkle: do thing',
      'More prose in between items.',
      '+ [ ] marcusrbrown/renovate-config: do thing',
      'Trailing prose.',
    ].join('\n')
    const result = parseDecomposition(body)
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]?.target).toEqual({owner: 'marcusrbrown', name: 'sparkle'})
    expect(result.items[1]?.target).toEqual({owner: 'marcusrbrown', name: 'renovate-config'})
  })
})

function makeReceipt(overrides: Partial<CrossRepoResult> = {}): CrossRepoResult {
  return {
    correlationId: 'abc123correlation',
    nonce: 'raw-nonce-value-1234567890',
    status: 'success',
    summary: 'did the thing',
    ...overrides,
  }
}

describe('buildResultMarker / parseResult round-trip', () => {
  it.each(['success', 'noop', 'failed'] as const)(
    'round-trips a %s receipt through region + marker + prose',
    status => {
      const receipt = makeReceipt({status})
      const body = ['Some prose before the receipt.', buildResultMarker(receipt), 'Some prose after the receipt.'].join(
        '\n',
      )
      const outcome = parseResult(body)
      expect(outcome.ok).toBe(true)
      expect(outcome.result).toEqual(receipt)
    },
  )

  it('emits the documented delimited-region shape', () => {
    const body = buildResultMarker(makeReceipt())
    const lines = body.split('\n')
    expect(lines[0]).toBe('<!-- fro-bot:cross-repo-result:start -->')
    expect(lines[1]).toMatch(/^<!-- fro-bot:cross-repo-result \{.*\} -->$/)
    expect(lines[2]).toBe('<!-- fro-bot:cross-repo-result:end -->')
  })

  it('round-trips the optional pr field when present', () => {
    const receipt = makeReceipt({pr: 'https://github.com/fro-bot/agent/pull/1'})
    const outcome = parseResult(buildResultMarker(receipt))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })

  it('omits pr from the parsed result when the receipt has none', () => {
    const outcome = parseResult(buildResultMarker(makeReceipt()))
    expect(outcome.ok).toBe(true)
    expect(outcome.result?.pr).toBeUndefined()
  })

  it('prefers the delimited region, ignoring an unrelated marker-shaped string outside it', () => {
    const receipt = makeReceipt({correlationId: 'inside-region'})
    const body = [
      '<!-- fro-bot:cross-repo-result {"correlation_id":"outside-region","nonce":"n","status":"failed","summary":"x"} -->',
      buildResultMarker(receipt),
    ].join('\n')
    // Region-preference only applies once a region exists; here the bare
    // marker precedes the region. extractResultMarkerJson takes the LAST
    // match within the selected scope (region body when present), so the
    // in-region receipt wins once the region is extracted.
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result?.correlationId).toBe('inside-region')
  })

  it('parses a marker inside a fenced code block with adjacent prose, region present', () => {
    const receipt = makeReceipt({status: 'noop', summary: 'nothing to do'})
    const body = [
      'Worker report:',
      '<!-- fro-bot:cross-repo-result:start -->',
      '```',
      JSON.stringify({
        correlation_id: receipt.correlationId,
        nonce: receipt.nonce,
        status: 'noop',
        summary: 'nothing to do',
      }),
      '```',
      '<!-- fro-bot:cross-repo-result:end -->',
      'End of report.',
    ].join('\n')
    // The fenced block above deliberately omits the marker HTML comment
    // itself (workers sometimes wrap only the JSON) — exercised instead via
    // the canonical marker-inside-region path below for the parseable case.
    const canonicalBody = ['Worker report:', buildResultMarker(receipt), 'End of report.'].join('\n')
    const outcome = parseResult(canonicalBody)
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
    // The malformed fenced-only variant (no marker comment) is `absent`.
    expect(parseResult(body).reason).toBe('absent')
  })

  it('parses a bare marker without the region via body-scan fallback', () => {
    const receipt = makeReceipt()
    const marker = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      correlation_id: receipt.correlationId,
      nonce: receipt.nonce,
      status: receipt.status,
      summary: receipt.summary,
    })} -->`
    const body = `Some prose.\n${marker}\nMore prose.`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })

  it('round-trips a nonce/summary containing characters that could break JSON quoting', () => {
    const receipt = makeReceipt({
      nonce: 'n"o\\nce\nwith\tquotes"and\\backslashes',
      summary: 'summary with "quotes", \\backslashes\\, and\nnewlines',
    })
    const outcome = parseResult(buildResultMarker(receipt))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })

  it('parses a receipt whose summary contains a literal --> without truncating the payload', () => {
    const receipt = makeReceipt({summary: 'see the arrow --> here; no change'})
    const outcome = parseResult(buildResultMarker(receipt))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })

  it('tracks string scope correctly when an escaped quote precedes an in-string -->', () => {
    const receipt = makeReceipt({summary: String.raw`note \"quoted\" then --> an arrow`})
    const outcome = parseResult(buildResultMarker(receipt))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })

  it('still applies last-marker-wins when the winning payload contains a literal -->', () => {
    const bareMarker = (receipt: CrossRepoResult) =>
      `<!-- fro-bot:cross-repo-result ${JSON.stringify({
        correlation_id: receipt.correlationId,
        nonce: receipt.nonce,
        status: receipt.status,
        summary: receipt.summary,
      })} -->`
    const first = makeReceipt({correlationId: 'first-marker', summary: 'first'})
    const second = makeReceipt({correlationId: 'second-marker', summary: 'second --> arrow'})
    const body = `Some prose.\n${bareMarker(first)}\n${bareMarker(second)}\nMore prose.`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result?.correlationId).toBe('second-marker')
    expect(outcome.result?.summary).toBe('second --> arrow')
  })

  it('treats a marker with no closing --> at all as absent', () => {
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      correlation_id: 'abc',
      nonce: 'n',
      status: 'success',
      summary: 'unterminated',
    })}`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
  })
})

describe('parseResult — malformed vs absent', () => {
  it('returns absent when no receipt marker is present at all', () => {
    const outcome = parseResult('just a regular comment with no receipt')
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
    expect(outcome.result).toBeUndefined()
  })

  it('returns absent for an empty body', () => {
    const outcome = parseResult('')
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
  })

  it('returns malformed for invalid JSON in the marker', () => {
    const outcome = parseResult('<!-- fro-bot:cross-repo-result {not json} -->')
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('returns malformed when nonce is missing', () => {
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      correlation_id: 'abc',
      status: 'success',
      summary: 'done',
    })} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('returns malformed when correlation_id is missing', () => {
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      nonce: 'n',
      status: 'success',
      summary: 'done',
    })} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('returns malformed when status is outside the closed vocabulary', () => {
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      correlation_id: 'abc',
      nonce: 'n',
      status: 'blocked',
      summary: 'done',
    })} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('returns malformed when summary is missing', () => {
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify({
      correlation_id: 'abc',
      nonce: 'n',
      status: 'success',
    })} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('never returns a partial result on a malformed marker', () => {
    const outcome = parseResult('<!-- fro-bot:cross-repo-result {"correlation_id":"abc"} -->')
    expect(outcome.ok).toBe(false)
    expect(outcome.result).toBeUndefined()
  })
})

describe('repairJsonStringEscapes', () => {
  it('drops the backslash from markdown-style escapes inside a string', () => {
    expect(repairJsonStringEscapes(String.raw`"\# Renovate Config Presets"`)).toBe('"# Renovate Config Presets"')
    expect(repairJsonStringEscapes(String.raw`"a \*bold\* b"`)).toBe('"a *bold* b"')
    expect(repairJsonStringEscapes(String.raw`"a \_em\_ b"`)).toBe('"a _em_ b"')
    expect(repairJsonStringEscapes(String.raw`"a \[link\] b"`)).toBe('"a [link] b"')
  })

  it('preserves valid JSON escapes unchanged, including a well-formed unicode escape', () => {
    const raw = String.raw`"line\nbreak\ttab\"quote\\backslash\u00e9"`
    expect(repairJsonStringEscapes(raw)).toBe(raw)
  })

  it('leaves a malformed unicode escape untouched (does not over-tolerate)', () => {
    expect(repairJsonStringEscapes(String.raw`"bad\uxeee"`)).toBe(String.raw`"bad\uxeee"`)
    expect(repairJsonStringEscapes(String.raw`"bad\u12"`)).toBe(String.raw`"bad\u12"`)
  })

  it('leaves a trailing lone backslash before the closing quote untouched', () => {
    expect(repairJsonStringEscapes(String.raw`"trailing\"`)).toBe(String.raw`"trailing\"`)
  })

  it('does not touch a backslash outside a string literal', () => {
    expect(repairJsonStringEscapes(String.raw`{\#not-a-string}`)).toBe(String.raw`{\#not-a-string}`)
  })

  it('does not toggle string state on an escaped quote', () => {
    // Without \" being recognized as non-toggling, the markdown escape after
    // it would incorrectly be treated as outside a string.
    expect(repairJsonStringEscapes(String.raw`"a\"b\#c"`)).toBe(String.raw`"a\"b#c"`)
  })
})

describe('parseResult — tolerant escape repair (markdown-escape drift)', () => {
  it('repairs the real-world failing case: backslash-hash inside summary', () => {
    const body = String.raw`<!-- fro-bot:cross-repo-result {"correlation_id":"abc123correlation","nonce":"raw-nonce-value-1234567890","status":"success","summary":"\# Renovate Config Presets"} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual({
      correlationId: 'abc123correlation',
      nonce: 'raw-nonce-value-1234567890',
      status: 'success',
      summary: '# Renovate Config Presets',
    })
  })

  it('repairs asterisk, underscore, and bracket escapes in summary', () => {
    const body = String.raw`<!-- fro-bot:cross-repo-result {"correlation_id":"c","nonce":"n","status":"success","summary":"\*bold\* \_em\_ \[link\]"} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result?.summary).toBe('*bold* _em_ [link]')
  })

  it('leaves a valid escape sequence unaffected by the repair path (still parses via strict JSON.parse)', () => {
    const payload = {
      correlation_id: 'c',
      nonce: 'n',
      status: 'success' as const,
      summary: 'line\nbreak\ttab"quote\\backslash\u00E9',
    }
    const body = `<!-- fro-bot:cross-repo-result ${JSON.stringify(payload)} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(true)
    expect(outcome.result?.summary).toBe('line\nbreak\ttab"quote\\backslash\u00E9')
  })

  it('does not repair a malformed unicode escape — still malformed', () => {
    const body = String.raw`<!-- fro-bot:cross-repo-result {"correlation_id":"c","nonce":"n","status":"success","summary":"bad\uxeee"} -->`
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('a genuinely broken marker (unterminated string) remains malformed after repair attempt', () => {
    const body =
      '<!-- fro-bot:cross-repo-result {"correlation_id":"c","nonce":"n","status":"success","summary":"unterminated -->'
    const outcome = parseResult(body)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('malformed')
  })

  it('a canonical buildResultMarker receipt with no bad escapes parses via the strict-first path unchanged', () => {
    const receipt = makeReceipt({summary: 'clean summary, no markdown escapes here'})
    const outcome = parseResult(buildResultMarker(receipt))
    expect(outcome.ok).toBe(true)
    expect(outcome.result).toEqual(receipt)
  })
})

describe('parseResult — nonce never logged/printed (R12 discipline check)', () => {
  it('parseResult itself performs no console output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseResult(buildResultMarker(makeReceipt({nonce: 'super-secret-nonce-value'})))
    expect(spy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    spy.mockRestore()
    errSpy.mockRestore()
  })
})

describe('extractItemPrompts', () => {
  it('round-trips prompts for `*` and `+` bulleted items, matching parseDecomposition hashes', () => {
    const body = [
      'Some prose introducing the plan.',
      '* [ ] marcusrbrown/sparkle: do thing',
      'More prose in between items.',
      '+ [ ] marcusrbrown/renovate-config: do thing',
      'Trailing prose.',
    ].join('\n')
    const parsed = parseDecomposition(body)
    expect(parsed.ok).toBe(true)
    const prompts = extractItemPrompts(body)
    for (const item of parsed.items) {
      expect(prompts.get(item.promptHash)).toBeDefined()
    }
    expect(prompts.get(parsed.items[0]?.promptHash ?? '')).toBe('do thing')
    expect(prompts.get(parsed.items[1]?.promptHash ?? '')).toBe('do thing')
  })

  it('agrees with parseDecomposition on a checklist-shaped but strictly invalid line: no prompts extracted', () => {
    const body = '- [ ] bad-target-no-slash do thing'
    const parsed = parseDecomposition(body)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe('malformed')

    const prompts = extractItemPrompts(body)
    expect(prompts.size).toBe(0)
  })

  it('agrees with parseDecomposition when a valid item is mixed with a malformed item: neither is emitted', () => {
    const body = ['- [ ] fro-bot/agent: do the thing', '- [ ] bad-target-no-slash do the other thing'].join('\n')
    const parsed = parseDecomposition(body)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe('malformed')

    const prompts = extractItemPrompts(body)
    expect(prompts.size).toBe(0)
  })
})

describe('computeApprovalFingerprint', () => {
  it('is stable under reordering', () => {
    const a = makeItem({id: 'a', target: {owner: 'fro-bot', name: 'agent'}, promptHash: 'hash-a'})
    const b = makeItem({id: 'b', target: {owner: 'marcusrbrown', name: 'dotfiles'}, promptHash: 'hash-b'})
    expect(computeApprovalFingerprint([a, b])).toBe(computeApprovalFingerprint([b, a]))
  })

  it('changes when an item is added', () => {
    const a = makeItem({id: 'a', target: {owner: 'fro-bot', name: 'agent'}, promptHash: 'hash-a'})
    const b = makeItem({id: 'b', target: {owner: 'marcusrbrown', name: 'dotfiles'}, promptHash: 'hash-b'})
    expect(computeApprovalFingerprint([a])).not.toBe(computeApprovalFingerprint([a, b]))
  })

  it('changes when an item is removed', () => {
    const a = makeItem({id: 'a', target: {owner: 'fro-bot', name: 'agent'}, promptHash: 'hash-a'})
    const b = makeItem({id: 'b', target: {owner: 'marcusrbrown', name: 'dotfiles'}, promptHash: 'hash-b'})
    expect(computeApprovalFingerprint([a, b])).not.toBe(computeApprovalFingerprint([b]))
  })

  it('is unaffected by cosmetic id changes but changes on target/promptHash change', () => {
    const a = makeItem({id: 'a', target: {owner: 'fro-bot', name: 'agent'}, promptHash: 'hash-a'})
    const aRenamed = makeItem({id: 'z', target: {owner: 'fro-bot', name: 'agent'}, promptHash: 'hash-a'})
    expect(computeApprovalFingerprint([a])).toBe(computeApprovalFingerprint([aRenamed]))
  })
})

describe('gateTarget', () => {
  const base: GateEntry = {owner: 'fro-bot', name: 'agent', has_fro_bot_workflow: true, private: false}

  it('allows an owner repo with the workflow and definitively public', () => {
    expect(gateTarget(base)).toBe('ok')
  })

  it('allows marcusrbrown-owned repos too', () => {
    expect(gateTarget({...base, owner: 'marcusrbrown'})).toBe('ok')
  })

  it('blocks a non-owner repo as ineligible', () => {
    expect(gateTarget({...base, owner: 'some-other-org'})).toBe('blocked-ineligible')
  })

  it('blocks a private repo as ineligible', () => {
    expect(gateTarget({...base, private: true})).toBe('blocked-ineligible')
  })

  it('blocks an indeterminate-privacy repo (private undefined) as ineligible, fail-closed', () => {
    expect(gateTarget({...base, private: undefined})).toBe('blocked-ineligible')
  })

  it('blocks missing has_fro_bot_workflow as not-onboarded', () => {
    expect(gateTarget({...base, has_fro_bot_workflow: false})).toBe('blocked-not-onboarded')
  })

  it('blocks a missing registry entry as ineligible', () => {
    expect(gateTarget(undefined)).toBe('blocked-ineligible')
  })
})

describe('classifyReceiptCapability', () => {
  const base: GateEntry = {owner: 'fro-bot', name: 'agent', has_fro_bot_workflow: true, private: false}

  it('classifies a target with the receipt capability as receipt-accountable', () => {
    expect(classifyReceiptCapability({...base, cross_repo_receipts: 'coordination-issue-v1'})).toBe(
      'receipt-accountable',
    )
  })

  it('classifies a target without the field as best-effort/legacy, not verified receipt-capable', () => {
    expect(classifyReceiptCapability(base)).toBe('legacy-best-effort')
  })

  it('classifies a missing registry entry as legacy/best-effort', () => {
    expect(classifyReceiptCapability(undefined)).toBe('legacy-best-effort')
  })

  it('fails closed on an unknown capability value', () => {
    expect(() => classifyReceiptCapability({...base, cross_repo_receipts: 'bogus-value'} as GateEntry)).toThrow(
      /cross_repo_receipts/,
    )
  })
})

describe('gateTargetForAccountableDispatch', () => {
  const base: GateEntry = {owner: 'fro-bot', name: 'agent', has_fro_bot_workflow: true, private: false}

  it('allows an eligible target that has opted into the receipt contract', () => {
    expect(gateTargetForAccountableDispatch({...base, cross_repo_receipts: 'coordination-issue-v1'})).toBe('ok')
  })

  it('rejects an eligible target without the receipt capability with a stable reason', () => {
    expect(gateTargetForAccountableDispatch(base)).toBe('blocked-receipt-contract-missing')
  })

  it('rejects an eligible target with no registry entry as ineligible before checking receipts', () => {
    expect(gateTargetForAccountableDispatch(undefined)).toBe('blocked-ineligible')
  })

  it('preserves existing gate reasons (not-onboarded) ahead of the receipt-contract check', () => {
    expect(gateTargetForAccountableDispatch({...base, has_fro_bot_workflow: false})).toBe('blocked-not-onboarded')
  })

  it('does not block legacy/best-effort dispatch mode for a target missing the capability', () => {
    // Legacy gate (used by today's best-effort dispatch) must remain unaffected by the new field.
    expect(gateTarget(base)).toBe('ok')
  })
})

describe('receipt backfill candidates (#3652)', () => {
  it('lists exactly the accepted-receipt targets from #3652', () => {
    expect([...RECEIPT_BACKFILL_CANDIDATES].sort()).toStrictEqual(
      ['fro-bot/agent', 'fro-bot/dashboard', 'marcusrbrown/gpt'].sort(),
    )
  })

  it('does not include local-only/no-receipt #3652 targets', () => {
    expect(RECEIPT_BACKFILL_CANDIDATES.has('marcusrbrown/containers')).toBe(false)
    expect(RECEIPT_BACKFILL_CANDIDATES.has('marcusrbrown/opencode-copilot-delegate')).toBe(false)
  })
})

describe('planDispatch', () => {
  it('skips already-dispatched and terminal items', () => {
    const state = makeState({
      items: [
        makeItem({id: 'a', status: 'dispatched'}),
        makeItem({id: 'b', status: 'completed'}),
        makeItem({id: 'c', status: 'pending'}),
      ],
    })
    const result = planDispatch({state, fingerprint: 'fp', otherOpenGoalMarkers: []})
    expect(result.toDispatch.map(i => i.id)).toEqual(['c'])
    expect(result.toDispatchCount).toBe(1)
  })

  it('defers items whose target has an in-flight item in another open goal', () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const state = makeState({items: [makeItem({id: 'a', target, status: 'pending'})]})
    const otherGoal = makeState({
      goal: 'other',
      items: [makeItem({id: 'x', target, status: 'dispatched'})],
    })
    const result = planDispatch({state, fingerprint: 'fp', otherOpenGoalMarkers: [otherGoal]})
    expect(result.toDispatch).toHaveLength(0)
    expect(result.deferred.map(i => i.id)).toEqual(['a'])
    expect(result.deferredCount).toBe(1)
  })

  it('does not defer when other goal item for same target is already terminal', () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const state = makeState({items: [makeItem({id: 'a', target, status: 'pending'})]})
    const otherGoal = makeState({
      goal: 'other',
      items: [makeItem({id: 'x', target, status: 'completed'})],
    })
    const result = planDispatch({state, fingerprint: 'fp', otherOpenGoalMarkers: [otherGoal]})
    expect(result.toDispatch.map(i => i.id)).toEqual(['a'])
  })

  it('counts blocked items separately from dispatch/defer', () => {
    const state = makeState({items: [makeItem({id: 'a', status: 'blocked'})]})
    const result = planDispatch({state, fingerprint: 'fp', otherOpenGoalMarkers: []})
    expect(result.blocked.map(i => i.id)).toEqual(['a'])
    expect(result.blockedCount).toBe(1)
    expect(result.toDispatch).toHaveLength(0)
  })
})

describe('planSnapshot', () => {
  it('applies a gate-block signal per dispatched item and flags allTerminal', () => {
    const state = makeState({items: [makeItem({id: 'a', status: 'dispatched'})], markerHash: 'old'})
    const result = planSnapshot({state, signals: {a: {gateBlocked: true}}})
    expect(result.state.items[0]?.status).toBe('blocked')
    expect(result.allTerminal).toBe(true)
    expect(result.shouldWrite).toBe(true)
  })

  it('stays open when not all items are terminal', () => {
    const state = makeState({
      items: [makeItem({id: 'a', status: 'dispatched'}), makeItem({id: 'b', status: 'dispatched'})],
      markerHash: 'old',
    })
    const result = planSnapshot({state, signals: {a: {gateBlocked: true}}})
    expect(result.allTerminal).toBe(false)
  })

  it('is idempotent — identical resulting hash yields shouldWrite false', () => {
    const item = makeItem({id: 'a', status: 'completed'})
    const state = makeState({items: [item]})
    const marker = serializeMarker(state)
    const stateWithHash = {...state, markerHash: marker.hash}
    const result = planSnapshot({state: stateWithHash, signals: {}})
    expect(result.shouldWrite).toBe(false)
  })
})

// ─── Shell tests ──────────────────────────────────────────────────────────────

interface MockComment {
  id: number
  body: string
  login: string
}

function mockOctokit(
  overrides: {
    comments?: MockComment[]
    createComment?: ReturnType<typeof vi.fn>
    updateComment?: ReturnType<typeof vi.fn>
    createWorkflowDispatch?: ReturnType<typeof vi.fn>
    removeLabel?: ReturnType<typeof vi.fn>
    update?: ReturnType<typeof vi.fn>
    listForRepo?: ReturnType<typeof vi.fn>
    listWorkflowRunsForRepo?: ReturnType<typeof vi.fn>
  } = {},
): {octokit: CrossRepoDispatchOctokitClient; comments: MockComment[]} {
  const comments = overrides.comments ?? []
  let nextId = comments.length + 1

  const createComment =
    overrides.createComment ??
    vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
      const comment = {id: nextId, body: params.body, login: 'fro-bot'}
      nextId += 1
      comments.push(comment)
      return {data: {id: comment.id}}
    })

  const updateComment =
    overrides.updateComment ??
    vi.fn(async (params: {comment_id: number; body: string}) => {
      const existing = comments.find(c => c.id === params.comment_id)
      if (existing !== undefined) existing.body = params.body
      return {}
    })

  const octokit: CrossRepoDispatchOctokitClient = {
    rest: {
      issues: {
        listComments: async () => ({
          data: comments.map(c => ({id: c.id, body: c.body, user: {login: c.login}})),
        }),
        createComment: createComment as CrossRepoDispatchOctokitClient['rest']['issues']['createComment'],
        updateComment: updateComment as CrossRepoDispatchOctokitClient['rest']['issues']['updateComment'],
        update: (overrides.update ??
          vi.fn(async () => ({data: {}}))) as CrossRepoDispatchOctokitClient['rest']['issues']['update'],
        removeLabel: (overrides.removeLabel ??
          vi.fn(async () => ({}))) as CrossRepoDispatchOctokitClient['rest']['issues']['removeLabel'],
        listForRepo: (overrides.listForRepo ??
          vi.fn(async () => ({data: []}))) as CrossRepoDispatchOctokitClient['rest']['issues']['listForRepo'],
      },
      actions: {
        createWorkflowDispatch: (overrides.createWorkflowDispatch ??
          vi.fn(async () => ({}))) as CrossRepoDispatchOctokitClient['rest']['actions']['createWorkflowDispatch'],
        listWorkflowRunsForRepo: (overrides.listWorkflowRunsForRepo ??
          vi.fn(async () => ({
            data: {workflow_runs: []},
          }))) as CrossRepoDispatchOctokitClient['rest']['actions']['listWorkflowRunsForRepo'],
      },
    },
  }

  return {octokit, comments}
}

function seedMarkerComment(comments: MockComment[], state: GoalState): void {
  comments.push({id: comments.length + 1, body: buildMarkerComment(state), login: 'fro-bot'})
}

function makeDecompositionBody(items: {owner: string; name: string; prompt: string}[]): string {
  return items.map(item => `- [ ] ${item.owner}/${item.name}: ${item.prompt}`).join('\n')
}

function makeLabeledEvent(overrides: Partial<LabeledEventPayload> = {}): LabeledEventPayload {
  return {
    label: {name: 'dispatch-approved'},
    sender: {login: REQUIRED_APPROVER},
    issue: {number: 42},
    ...overrides,
  }
}

const REPO = {owner: 'fro-bot', repo: '.github'}
const TARGET_A = {owner: 'fro-bot', name: 'agent'}
const TARGET_MARCUSRBROWN = {owner: 'marcusrbrown', name: 'sparkle'}

function gateEntryFor(target: DispatchTarget): GateEntry {
  return {owner: target.owner, name: target.name, has_fro_bot_workflow: true, private: false}
}

/**
 * Test-only single-client resolver: every owner routes to the SAME fake
 * client — legacy single-client wiring adapted minimally so existing tests
 * that don't care about owner routing keep passing.
 */
function singleOwnerResolver(client: CrossRepoDispatchOctokitClient) {
  return async () =>
    createTargetClientResolver(
      new Map([
        ['fro-bot', client],
        ['marcusrbrown', client],
      ]),
    )
}

describe('runDispatch — actor gate', () => {
  it('refuses and removes the label when sender is not marcusrbrown, even if workflow gate bypassed', async () => {
    const removeLabel = vi.fn(async () => ({}))
    const {octokit} = mockOctokit({removeLabel})
    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent({sender: {login: 'some-attacker'}}),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.refused).toBe(1)
    expect(removeLabel).toHaveBeenCalledOnce()
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('refuses when the label name does not match approveLabel', async () => {
    const {octokit} = mockOctokit()
    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent({label: {name: 'wrong-label'}}),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'nonce-1',
    })
    expect(result.counts.refused).toBe(1)
  })
})

describe('runDispatch — happy sequential dispatch', () => {
  it('dispatches 3 items sequentially with the correct createWorkflowDispatch shape', async () => {
    const targets = [
      {owner: 'fro-bot', name: 'agent'},
      {owner: 'fro-bot', name: 'wiki'},
      {owner: 'marcusrbrown', name: 'dotfiles'},
    ]
    const decomposition = makeDecompositionBody(targets.map(t => ({...t, prompt: `do work in ${t.name}`})))
    const items: DispatchItem[] = targets.map((target, index) => ({
      id: `item-${index + 1}`,
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }))
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(
      async (_params: {
        owner: string
        repo: string
        workflow_id: string
        ref: string
        inputs: {prompt: string}
      }) => ({}),
    )

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => targets.map(t => gateEntryFor(t)),
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: (() => {
        let n = 0
        return () => `nonce-${++n}`
      })(),
    })

    expect(result.counts.dispatched).toBe(3)
    expect(createWorkflowDispatch).toHaveBeenCalledTimes(3)
    for (const [index, target] of targets.entries()) {
      const call = createWorkflowDispatch.mock.calls[index]?.[0]
      expect(call?.owner).toBe(target.owner)
      expect(call?.repo).toBe(target.name)
      expect(call?.workflow_id).toBe('fro-bot.yaml')
      expect(call?.ref).toBe('main')
      expect(call?.inputs.prompt).toContain(`do work in ${target.name}`)
      expect(call?.inputs).not.toHaveProperty('correlation_id')
      expect(Object.keys(call?.inputs ?? {})).toEqual(['prompt'])
    }
  })
})

describe('runDispatch — nonce mint + receipt-carrying prompt (Unit 2)', () => {
  it('stores a full-SHA-256 nonceHash and builds a prompt with correlation id, raw nonce, issue ref, and a literal receipt example', async () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const decomposition = makeDecompositionBody([{...target, prompt: 'do the thing'}])
    const item: DispatchItem = {
      id: 'item-1',
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(target)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'raw-nonce-abc',
    })

    const call = createWorkflowDispatch.mock.calls[0]?.[0] as {
      inputs: {prompt: string}
    }
    expect(call.inputs).not.toHaveProperty('correlation_id')
    expect(Object.keys(call.inputs)).toEqual(['prompt'])
    const prompt = call.inputs.prompt
    const correlationIdMatch = /correlation_id: (\S+)/.exec(prompt)
    const correlationId = correlationIdMatch?.[1]
    expect(correlationId).toBeDefined()

    expect(prompt).toContain(correlationId as string)
    expect(prompt).toContain('raw-nonce-abc')
    expect(prompt).toContain(`owner: ${REPO.owner}`)
    expect(prompt).toContain(`repo: ${REPO.repo}`)
    expect(prompt).toContain('number: 42')
    expect(prompt).toContain(`https://github.com/${REPO.owner}/${REPO.repo}/issues/42`)
    expect(prompt).toContain('fro-bot:cross-repo-result')
    expect(prompt).toContain('"status":"success"')
    expect(prompt).toContain('"status":"noop"')

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const storedItem = finalMarker?.state.items.find(i => i.id === 'item-1')
    expect(storedItem?.nonceHash).toBeDefined()
    expect(storedItem?.nonceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('never stores the raw nonce in the marker, and the stored hash is not the 64-bit hashState truncation', async () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const decomposition = makeDecompositionBody([{...target, prompt: 'do the thing'}])
    const item: DispatchItem = {
      id: 'item-1',
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(target)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'super-secret-raw-nonce',
    })

    const markerBodies = comments.map(c => c.body).join('\n')
    expect(markerBodies).not.toContain('super-secret-raw-nonce')

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const storedItem = finalMarker?.state.items.find(i => i.id === 'item-1')
    expect(storedItem?.nonceHash).toBeDefined()
    // Full SHA-256 hex is 64 chars; hashState truncates to 16.
    expect(storedItem?.nonceHash).toHaveLength(64)
  })

  it('gives two items in one goal distinct nonces and distinct hashes', async () => {
    const targets = [
      {owner: 'fro-bot', name: 'agent'},
      {owner: 'fro-bot', name: 'wiki'},
    ]
    const decomposition = makeDecompositionBody(targets.map(t => ({...t, prompt: `do work in ${t.name}`})))
    const items: DispatchItem[] = targets.map((target, index) => ({
      id: `item-${index + 1}`,
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }))
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))
    const seenNonces: string[] = []

    await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => targets.map(t => gateEntryFor(t)),
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: (() => {
        let n = 0
        return () => {
          const nonce = `distinct-nonce-${++n}`
          seenNonces.push(nonce)
          return nonce
        }
      })(),
    })

    expect(new Set(seenNonces).size).toBe(2)

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const hashes = finalMarker?.state.items.map(i => i.nonceHash) ?? []
    expect(hashes).toHaveLength(2)
    expect(new Set(hashes).size).toBe(2)
  })

  it('mint↔prompt consistency: sha256hex(raw nonce embedded in the prompt) equals the stored nonceHash', async () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const decomposition = makeDecompositionBody([{...target, prompt: 'do the thing'}])
    const item: DispatchItem = {
      id: 'item-1',
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(target)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'consistency-check-nonce',
    })

    const call = createWorkflowDispatch.mock.calls[0]?.[0] as {inputs: {prompt: string}}
    const nonceLine = call.inputs.prompt.split('\n').find(line => line.startsWith('nonce: '))
    const rawNonceFromPrompt = nonceLine?.slice('nonce: '.length)
    expect(rawNonceFromPrompt).toBe('consistency-check-nonce')

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const storedItem = finalMarker?.state.items.find(i => i.id === 'item-1')

    expect(rawNonceFromPrompt).toBeDefined()
    const {createHash} = await import('node:crypto')
    const computedHash = createHash('sha256')
      .update(rawNonceFromPrompt as string)
      .digest('hex')
    expect(storedItem?.nonceHash).toBe(computedHash)
  })

  it('sets epoch only at confirmed dispatch; an item left at intent has no SLA-eligible epoch', async () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const decomposition = makeDecompositionBody([{...target, prompt: 'do the thing'}])
    const item: DispatchItem = {
      id: 'item-1',
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    // The approval-fingerprint write (1st updateComment call) and the intent
    // write (2nd call) are allowed to land normally; the confirm write (3rd
    // call, which would set 'dispatched' + epoch) is accepted by the mock (no
    // throw) but silently discarded — simulating a crash-after-confirm
    // scenario where the item is stranded at 'intent'.
    let writeCount = 0
    const originalUpdateComment = octokit.rest.issues.updateComment
    const droppingUpdateComment = async (params: {owner: string; repo: string; comment_id: number; body: string}) => {
      writeCount += 1
      if (writeCount >= 3) {
        return {}
      }
      return originalUpdateComment(params)
    }

    const patchedOctokit = {
      ...octokit,
      rest: {
        ...octokit.rest,
        issues: {
          ...octokit.rest.issues,
          updateComment: droppingUpdateComment,
        },
      },
    }

    await runDispatch({
      octokit: patchedOctokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(target)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'intent-only-nonce',
    })

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const storedItem = finalMarker?.state.items.find(i => i.id === 'item-1')
    expect(storedItem?.status).toBe('intent')
    expect(storedItem?.epoch).toBeUndefined()
  })

  it('a createWorkflowDispatch throw for one target does not abort the cohort: counts dispatchError, still dispatches the rest, leaves the failed item at intent', async () => {
    const targetA = {owner: 'fro-bot', name: 'agent'}
    const targetB = {owner: 'fro-bot', name: 'wiki'}
    const decomposition = makeDecompositionBody([
      {...targetA, prompt: 'work-a'},
      {...targetB, prompt: 'work-b'},
    ])
    const items: DispatchItem[] = [
      {id: 'item-1', target: targetA, promptHash: extractPromptHash(decomposition, targetA), status: 'pending'},
      {id: 'item-2', target: targetB, promptHash: extractPromptHash(decomposition, targetB), status: 'pending'},
    ]
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (params: {owner: string; repo: string}): Promise<void> => {
      if (params.owner === targetA.owner && params.repo === targetA.name) {
        throw new Error('simulated transient dispatch failure')
      }
    })

    let result: RunDispatchResult | undefined
    let thrown: unknown
    try {
      result = await runDispatch({
        octokit,
        event: makeLabeledEvent(),
        repo: REPO,
        approveLabel: 'dispatch-approved',
        loadRegistry: async () => [gateEntryFor(targetA), gateEntryFor(targetB)],
        loadOtherOpenGoalMarkers: async () => [],
        findRunByCorrelationId: async () => false,
        createWorkflowDispatch,
        nonceSource: (() => {
          let n = 0
          return () => `nonce-${++n}`
        })(),
      })
    } catch (error) {
      thrown = error
    }

    // The createWorkflowDispatch throw must never propagate out of runDispatch.
    expect(thrown).toBeUndefined()
    expect(result).toBeDefined()
    expect(result?.counts.dispatchError).toBe(1)
    expect(result?.counts.dispatched).toBe(1)

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const failedItem = finalMarker?.state.items.find(i => i.id === 'item-1')
    const succeededItem = finalMarker?.state.items.find(i => i.id === 'item-2')
    expect(failedItem?.status).toBe('intent')
    expect(failedItem?.epoch).toBeUndefined()
    expect(succeededItem?.status).toBe('dispatched')
    expect(succeededItem?.epoch).toBeDefined()

    // The loop completed and writeResult still ran (both items were attempted).
    expect(createWorkflowDispatch).toHaveBeenCalledTimes(2)
  })

  it('telemetry: counts output for a dispatch run contains neither the raw nonce nor the hash', async () => {
    const target = {owner: 'fro-bot', name: 'agent'}
    const decomposition = makeDecompositionBody([{...target, prompt: 'do the thing'}])
    const item: DispatchItem = {
      id: 'item-1',
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(target)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'telemetry-check-nonce',
    })

    const countsJson = JSON.stringify(result.counts)
    expect(countsJson).not.toContain('telemetry-check-nonce')
    // No field on RunDispatchCounts carries nonce material at all — it's counts-only.
    expect(Object.keys(result.counts).every(key => !key.toLowerCase().includes('nonce'))).toBe(true)
  })
})

describe('runDispatch — seeds marker from decomposition checklist', () => {
  it('seeds a marker from the checklist, gates+dispatches items, and recovers prompts when no marker exists', async () => {
    const targets = [
      {owner: 'fro-bot', name: 'agent'},
      {owner: 'fro-bot', name: 'wiki'},
    ]
    const decomposition = makeDecompositionBody(targets.map(t => ({...t, prompt: `do work in ${t.name}`})))

    const {octokit, comments} = mockOctokit()
    // Only the bot-authored decomposition checklist exists — no state marker yet.
    comments.push({id: 1, body: decomposition, login: 'fro-bot'})

    const createComment = vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
      const comment = {id: comments.length + 1, body: params.body, login: 'fro-bot'}
      comments.push(comment)
      return {data: {id: comment.id}}
    })

    const createWorkflowDispatch = vi.fn(
      async (_params: {
        owner: string
        repo: string
        workflow_id: string
        ref: string
        inputs: {prompt: string}
      }) => ({}),
    )

    const result = await runDispatch({
      octokit: {...octokit, rest: {...octokit.rest, issues: {...octokit.rest.issues, createComment}}},
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => targets.map(t => gateEntryFor(t)),
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: (() => {
        let n = 0
        return () => `nonce-${++n}`
      })(),
    })

    expect(result.counts.dispatched).toBe(2)
    expect(createComment).toHaveBeenCalledOnce()
    expect(createWorkflowDispatch).toHaveBeenCalledTimes(2)
    for (const [index, target] of targets.entries()) {
      const call = createWorkflowDispatch.mock.calls[index]?.[0]
      expect(call?.owner).toBe(target.owner)
      expect(call?.repo).toBe(target.name)
      expect(call?.inputs.prompt).toContain(`do work in ${target.name}`)
    }
  })

  it('bails without dispatching when no marker exists and no decomposition checklist is found', async () => {
    const {octokit, comments} = mockOctokit()
    // A bot comment exists but it is not a valid decomposition checklist.
    comments.push({id: 1, body: 'just a status update, nothing structured here', login: 'fro-bot'})

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.dispatched).toBe(0)
    expect(result.counts.refused).toBe(0)
    expect(result.counts.seedRejected).toBe(0)
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('bails with seedRejected:1 when the latest checklist exceeds the item cap', async () => {
    const targets = Array.from({length: MAX_ITEMS_PER_GOAL + 1}, (_, i) => ({
      owner: 'fro-bot',
      name: `repo-${i}`,
      prompt: `do thing ${i}`,
    }))
    const decomposition = makeDecompositionBody(targets)

    const {octokit, comments} = mockOctokit()
    // Over-cap checklist, no existing state marker.
    comments.push({id: 1, body: decomposition, login: 'fro-bot'})

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.dispatched).toBe(0)
    expect(result.counts.seedRejected).toBe(1)
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('bails with seedRejected:1 when the latest checklist-shaped comment fails the strict grammar', async () => {
    const {octokit, comments} = mockOctokit()
    // Task-list-shaped but the target/prompt grammar is invalid — a visible
    // rejected seed, not a silent no-op indistinguishable from "no checklist".
    comments.push({id: 1, body: '- [ ] not-a-valid-target-format do the thing', login: 'fro-bot'})

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.dispatched).toBe(0)
    expect(result.counts.seedRejected).toBe(1)
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
  })
})

describe('runDispatch — marker comment upsert (no comment spam)', () => {
  it('writes exactly one marker comment (created once) and updates it in place thereafter', async () => {
    const targets = [
      {owner: 'fro-bot', name: 'agent'},
      {owner: 'fro-bot', name: 'wiki'},
      {owner: 'marcusrbrown', name: 'dotfiles'},
    ]
    const decomposition = makeDecompositionBody(targets.map(t => ({...t, prompt: `do work in ${t.name}`})))
    const items: DispatchItem[] = targets.map((target, index) => ({
      id: `item-${index + 1}`,
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }))
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    // Marker comment already exists (decomposition committed it) — the seeded
    // comment id is the single marker comment every subsequent write targets.
    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)
    const markerCommentId = comments.at(-1)?.id

    const createComment = vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
      const comment = {id: comments.length + 1, body: params.body, login: 'fro-bot'}
      comments.push(comment)
      return {data: {id: comment.id}}
    })
    const updateComment = vi.fn(async (params: {comment_id: number; body: string}) => {
      const existing = comments.find(c => c.id === params.comment_id)
      if (existing !== undefined) existing.body = params.body
      return {}
    })

    const result = await runDispatch({
      octokit: {
        ...octokit,
        rest: {...octokit.rest, issues: {...octokit.rest.issues, createComment, updateComment}},
      },
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => targets.map(t => gateEntryFor(t)),
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: (() => {
        let n = 0
        return () => `nonce-${++n}`
      })(),
    })

    expect(result.counts.dispatched).toBe(3)
    // The marker comment already existed, so no new marker comment is ever created.
    expect(createComment).not.toHaveBeenCalled()
    // Every state transition (approval + intent/confirm x 3 items = 7 writes)
    // updates that same comment in place instead of appending a new one.
    expect(updateComment).toHaveBeenCalledTimes(7)
    for (const call of updateComment.mock.calls) {
      expect(call[0]?.comment_id).toBe(markerCommentId)
    }
    // Only the single seeded marker comment exists on the issue — no spam.
    const markerComments = comments.filter(c => c.login === 'fro-bot' && extractMarker(c.body) !== null)
    expect(markerComments).toHaveLength(1)
  })

  it('creates the marker comment once on cold start (approval write, no prior bot marker), then updates it', async () => {
    const decomposition = '- [ ] fro-bot/agent: do the thing'
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: extractPromptHash(decomposition, TARGET_A),
      status: 'pending',
    }
    // Seed only a bare marker with no approvalFingerprint yet, authored by the bot,
    // so runDispatch's very first CAS write (the approval record) is a cold-start
    // create against this single comment id, then all following writes update it.
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)
    const seededCommentId = comments.at(-1)?.id

    const createComment = vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
      const comment = {id: comments.length + 1, body: params.body, login: 'fro-bot'}
      comments.push(comment)
      return {data: {id: comment.id}}
    })
    const updateComment = vi.fn(async (params: {comment_id: number; body: string}) => {
      const existing = comments.find(c => c.id === params.comment_id)
      if (existing !== undefined) existing.body = params.body
      return {}
    })

    const result = await runDispatch({
      octokit: {
        ...octokit,
        rest: {...octokit.rest, issues: {...octokit.rest.issues, createComment, updateComment}},
      },
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.dispatched).toBe(1)
    // A single bot marker comment already existed, so every write (approval,
    // intent, confirm) updates it in place — no createComment at all.
    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).toHaveBeenCalledTimes(3)
    for (const call of updateComment.mock.calls) {
      expect(call[0]?.comment_id).toBe(seededCommentId)
    }
  })
})

function extractPromptHash(decompositionBody: string, target: DispatchTarget): string {
  const parsed = parseDecomposition(decompositionBody)
  const found = parsed.items.find(item => item.target.owner === target.owner && item.target.name === target.name)
  if (found === undefined) throw new Error('fixture error: target not found in decomposition')
  return found.promptHash
}

describe('runDispatch — fingerprint halt on mid-loop edit', () => {
  it('halts remaining dispatch when the marker fingerprint mismatches mid-loop', async () => {
    const targets = [TARGET_A, {owner: 'fro-bot', name: 'wiki'}]
    const decomposition = makeDecompositionBody(targets.map(t => ({...t, prompt: `work-${t.name}`})))
    const items: DispatchItem[] = targets.map((target, index) => ({
      id: `item-${index + 1}`,
      target,
      promptHash: extractPromptHash(decomposition, target),
      status: 'pending',
    }))
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    // Simulate a human edit landing mid-loop: after item-1's own three marker
    // writes (approval + intent + confirm) land, inject an edited marker with
    // a different fingerprint before item-2's pre-check read. The marker
    // comment already exists (seeded), so all three writes are in-place
    // updates, not new comments.
    let writeCount = 0
    const baseUpdateComment = vi.fn(async (params: {comment_id: number; body: string}) => {
      const existing = comments.find(c => c.id === params.comment_id)
      if (existing !== undefined) existing.body = params.body
      writeCount += 1
      if (writeCount === 3) {
        const editedState: GoalState = {
          goal: 'goal-1',
          items: [...items, {id: 'item-3', target: TARGET_A, promptHash: 'zzzz000011112222', status: 'pending'}],
          markerHash: '',
        }
        comments.push({id: comments.length + 1, body: buildMarkerComment(editedState), login: 'fro-bot'})
      }
      return {}
    })

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit: {
        ...octokit,
        rest: {...octokit.rest, issues: {...octokit.rest.issues, updateComment: baseUpdateComment}},
      },
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => targets.map(t => gateEntryFor(t)),
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: (() => {
        let n = 0
        return () => `nonce-${++n}`
      })(),
    })

    expect(result.counts.dispatched).toBe(1)
    expect(createWorkflowDispatch).toHaveBeenCalledTimes(1)
  })
})

describe('runDispatch — blocked target dispatches the rest', () => {
  it('skips a blocked target and dispatches the eligible one', async () => {
    const blockedTarget = {owner: 'some-other-org', name: 'private-thing'}
    const okTarget = TARGET_A
    const decomposition = makeDecompositionBody([
      {...blockedTarget, prompt: 'blocked work'},
      {...okTarget, prompt: 'ok work'},
    ])
    const items: DispatchItem[] = [
      {
        id: 'item-1',
        target: blockedTarget,
        promptHash: extractPromptHash(decomposition, blockedTarget),
        status: 'pending',
      },
      {id: 'item-2', target: okTarget, promptHash: extractPromptHash(decomposition, okTarget), status: 'pending'},
    ]
    const state: GoalState = {goal: 'goal-1', items, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      // blockedTarget is absent from the registry → blocked-ineligible.
      loadRegistry: async () => [gateEntryFor(okTarget)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.dispatched).toBe(1)
    expect(result.counts.blocked).toBe(1)
    expect(createWorkflowDispatch).toHaveBeenCalledOnce()
    expect(createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({owner: okTarget.owner, repo: okTarget.name}),
    )
  })
})

describe('runDispatch — resume reconciliation by correlation-id', () => {
  it('reconciles an intent item by correlation-id lookup without re-dispatching', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'abcd1234abcd1234',
      status: 'intent',
      correlationId: 'corr-existing-1',
      nonceHash: 'nonce-hash-1',
    }
    const state: GoalState = {
      goal: 'goal-1',
      items: [item],
      approvalFingerprint: computeApprovalFingerprint([item]),
      markerHash: '',
    }
    const decomposition = '- [ ] fro-bot/agent: do the thing'

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))
    const findRunByCorrelationId = vi.fn(async (_target: DispatchTarget, _correlationId: string) => true)

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async (target, correlationId) => findRunByCorrelationId(target, correlationId),
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-2',
    })

    expect(findRunByCorrelationId).toHaveBeenCalledWith(TARGET_A, 'corr-existing-1')
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
    expect(result.counts.reconciled).toBe(1)
  })
})

describe('runDispatch — CAS mismatch defers', () => {
  it('defers when the marker changes underneath a concurrent write, after bounded retries', async () => {
    const decomposition = '- [ ] fro-bot/agent: do the thing'
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: extractPromptHash(decomposition, TARGET_A),
      status: 'pending',
    }
    const fingerprint = computeApprovalFingerprint([item])
    const state: GoalState = {goal: 'goal-1', items: [item], approvalFingerprint: fingerprint, markerHash: ''}

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    // Every read returns a marker with a freshly rotated (unpredictable) hash,
    // so the CAS write's expected-prior-hash never matches — simulating a
    // marker that keeps changing underneath a concurrent writer.
    let spin = 0
    const rotatingListComments = async () => {
      spin += 1
      const spinning: GoalState = {
        goal: 'goal-1',
        items: [{...item, nonceHash: `spin-${spin}`}],
        approvalFingerprint: fingerprint,
        markerHash: '',
      }
      return {
        data: [
          {id: 1, body: decomposition, user: {login: 'marcusrbrown'}},
          {id: 2, body: buildMarkerComment(spinning), user: {login: 'fro-bot'}},
        ],
      }
    }

    const result = await runDispatch({
      octokit: {
        ...octokit,
        rest: {...octokit.rest, issues: {...octokit.rest.issues, listComments: rotatingListComments}},
      },
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'nonce-1',
    })

    expect(result.counts.casDeferred).toBeGreaterThan(0)
  })
})

function makeOpenGoal(state: GoalState): OpenGoalIssue {
  const marker = serializeMarker(state)
  return {issueNumber: 7, marker: {hash: marker.hash, state: marker.state}}
}

function mockOctokitForGoal(goalIssue: OpenGoalIssue, overrides: Parameters<typeof mockOctokit>[0] = {}) {
  return mockOctokit({
    ...overrides,
    comments: [
      {
        id: 1,
        body: buildMarkerComment({...goalIssue.marker.state, markerHash: goalIssue.marker.hash}),
        login: 'fro-bot',
      },
      ...(overrides.comments ?? []),
    ],
  })
}

describe('runTrack — run-lookup is diagnostic-only, never authoritative (Unit 5)', () => {
  it('a dispatched item with no receipt and pre-SLA is untouched — run-lookup is not consulted at all', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const findRunConclusion = vi.fn(async () => 'success' as const)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion,
      now: () => RECEIPT_SLA_MS - 1,
    })
    // Pre-SLA, no receipt: item stays dispatched (non-terminal), and
    // run-lookup is never called — it only fires once an item is already
    // needs-attention/no-receipt.
    expect(findRunConclusion).not.toHaveBeenCalled()
    expect(result.counts.itemsCompleted).toBe(0)
    expect(result.counts.itemsFailed).toBe(0)
    expect(result.counts.goalsClosed).toBe(0)
  })

  it('a concluded run for a no-receipt needs-attention item never flips it terminal, even on run success', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
      now: () => RECEIPT_SLA_MS + 1,
    })
    // Past SLA, no receipt -> needs-attention, NOT completed, regardless of
    // the run-lookup's (diagnostic-only) success conclusion.
    expect(result.counts.itemsCompleted).toBe(0)
    expect(result.counts.itemsNeedsAttention).toBe(1)
    expect(result.counts.goalsClosed).toBe(0)
  })

  it('diagnostic: a no-receipt needs-attention item with a concluded run is annotated "ran-no-report"', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit, comments} = mockOctokitForGoal(goalIssue)
    const findRunConclusion = vi.fn(async () => 'success' as const)
    await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion,
      now: () => RECEIPT_SLA_MS + 1,
    })
    expect(findRunConclusion).toHaveBeenCalledWith(TARGET_A, 'c1')
    const markerComment = comments.find(c => c.body.includes('cross-repo-dispatch'))
    const marker = markerComment === undefined ? null : extractMarker(markerComment.body)
    const updatedItem = marker?.state.items.find(candidate => candidate.id === 'item-1')
    expect(updatedItem?.status).toBe('needs-attention')
    expect(updatedItem?.needsAttentionReason).toBe('no-receipt')
    expect(updatedItem?.noReceiptDiagnostic).toBe('ran-no-report')
  })

  it('diagnostic: a no-receipt needs-attention item with no run at all is annotated "never-ran"', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit, comments} = mockOctokitForGoal(goalIssue)
    const findRunConclusion = vi.fn(async () => undefined)
    await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion,
      now: () => RECEIPT_SLA_MS + 1,
    })
    expect(findRunConclusion).toHaveBeenCalledWith(TARGET_A, 'c1')
    const markerComment = comments.find(c => c.body.includes('cross-repo-dispatch'))
    const marker = markerComment === undefined ? null : extractMarker(markerComment.body)
    const updatedItem = marker?.state.items.find(candidate => candidate.id === 'item-1')
    expect(updatedItem?.status).toBe('needs-attention')
    expect(updatedItem?.needsAttentionReason).toBe('no-receipt')
    expect(updatedItem?.noReceiptDiagnostic).toBe('never-ran')
  })

  it('run-failure for a no-receipt needs-attention item does not resolve it to failed', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'failure',
      now: () => RECEIPT_SLA_MS + 1,
    })
    expect(result.counts.itemsFailed).toBe(0)
    expect(result.counts.itemsNeedsAttention).toBe(1)
  })

  it('gate-blocked item resolves to blocked without ever consulting run-lookup', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const findRunConclusion = vi.fn(async () => 'success' as const)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [], // TARGET_A not registered -> ineligible
      findRunConclusion,
      now: () => 0,
    })
    expect(findRunConclusion).not.toHaveBeenCalled()
    expect(result.counts.itemsBlocked).toBe(1)
    expect(result.counts.goalsClosed).toBe(1)
  })

  it('is idempotent — no signal change yields no write and no comment', async () => {
    const item: DispatchItem = {id: 'item-1', target: TARGET_A, promptHash: 'h', status: 'completed'}
    const state: GoalState = {goal: 'g', items: [item], markerHash: ''}
    const marker = serializeMarker(state)
    const goalIssue: OpenGoalIssue = {issueNumber: 7, marker: {hash: marker.hash, state: marker.state}}

    const createComment = vi.fn(async () => ({data: {id: 1}}))
    const {octokit} = mockOctokit({createComment})
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
    })
    expect(result.counts.idempotentNoop).toBe(1)
    expect(createComment).not.toHaveBeenCalled()
  })
})

// ─── Unit 4: receipt-driven terminal-state resolution + 24h SLA ─────────────

function makeReceiptComment(receipt: CrossRepoResult, login = 'fro-bot'): {id: number; body: string; login: string} {
  return {id: 0, body: buildResultMarker(receipt), login}
}

function makeDispatchedItem(overrides: Partial<DispatchItem> = {}): DispatchItem {
  const rawNonce = overrides.nonceHash === null ? undefined : 'raw-nonce-for-item'
  return {
    id: 'item-1',
    target: TARGET_A,
    promptHash: 'h',
    status: 'dispatched',
    correlationId: 'corr-1',
    epoch: 1_000_000,
    nonceHash: rawNonce === undefined ? undefined : hashNonce(rawNonce),
    ...overrides,
  }
}

describe('resolveReceipts — three-gate trust + earliest-wins (pure core)', () => {
  const RAW_NONCE = 'raw-nonce-for-item'
  const item: DispatchItem = {
    id: 'item-1',
    target: TARGET_A,
    promptHash: 'h',
    status: 'dispatched',
    correlationId: 'corr-1',
    epoch: 1_000_000,
    nonceHash: hashNonce(RAW_NONCE),
  }

  it('authentic success resolves to terminal success', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBe('success')
  })

  it('authentic noop resolves to terminal noop', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'noop'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBe('noop')
  })

  it('authentic failed resolves to terminal failed', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'failed'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBe('failed')
  })

  it('security: a receipt whose raw nonce does not hash to the stored nonceHash is rejected', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: 'wrong-nonce', status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
  })

  it('security: tolerant escape repair does not bypass the nonce hash gate — a repaired nonce that still mismatches nonceHash is rejected', () => {
    // The nonce field itself contains a markdown-style escape that repairJsonStringEscapes
    // will strip (\# -> #), so JSON.parse succeeds on the repaired copy. The repaired,
    // human-readable nonce does NOT hash to this item's stored nonceHash (which was
    // computed over the real raw nonce), so the receipt must still be rejected outright.
    const body = String.raw`<!-- fro-bot:cross-repo-result {"correlation_id":"corr-1","nonce":"\# not-the-real-nonce","status":"success","summary":"done"} -->`
    const comments: TrackerComment[] = [{author: {login: 'fro-bot'}, body}]
    // Sanity: the repair does make this parseable at all (parseResult succeeds).
    expect(parseResult(body).ok).toBe(true)
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
  })

  it('security: a receipt carrying item A correlation id but item B nonce is rejected — cannot resolve A', () => {
    const itemB: DispatchItem = {
      id: 'item-2',
      target: TARGET_A,
      promptHash: 'h2',
      status: 'dispatched',
      correlationId: 'corr-2',
      epoch: 1_000_000,
      nonceHash: hashNonce('raw-nonce-for-item-b'),
    }
    const comments: TrackerComment[] = [
      // Forged: correlation id points at item A, but the nonce is item B's raw nonce.
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(
          makeReceipt({correlationId: 'corr-1', nonce: 'raw-nonce-for-item-b', status: 'success'}),
        ),
      },
    ]
    const resolutions = resolveReceipts([item, itemB], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
    expect(resolutions.get('item-2')?.terminal).toBeUndefined()
  })

  it('error path: a non-Fro-Bot-authored comment with a valid-looking marker is ignored', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'random-user'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
  })

  it('a bot-authored comment whose id matches no item is ignored for state', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'no-such-item', nonce: RAW_NONCE, status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.size).toBe(0)
  })

  it('R6b: bot-authored malformed marker for a dispatched item -> unparseable-receipt (non-terminal)', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: `<!-- fro-bot:cross-repo-result {"correlation_id":"corr-1","nonce":"x"} -->`, // missing status/summary
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
    expect(resolutions.get('item-1')?.attentionReason).toBe('unparseable-receipt')
  })

  it('early-receipt tolerance: an authentic receipt for a not-yet-confirmed item (no epoch) is retained, not dropped', () => {
    const unconfirmed: DispatchItem = {...item, epoch: undefined}
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([unconfirmed], comments)
    expect(resolutions.get('item-1')?.terminal).toBeUndefined()
    expect(resolutions.get('item-1')?.retainedUnconfirmed).toBe(true)

    // Next pass, once confirmed (epoch set): the SAME receipt now resolves it.
    const resolutionsNextPass = resolveReceipts([item], comments)
    expect(resolutionsNextPass.get('item-1')?.terminal).toBe('success')
  })

  it('earliest-wins/replay: authentic failed then later authentic success stays failed (never flips)', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'failed'})),
      },
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'success'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBe('failed')
  })

  it('earliest-wins/replay: a second authentic receipt reusing the now-public nonce after resolution never flips the item', () => {
    const comments: TrackerComment[] = [
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'success'})),
      },
      // Attacker/replay: posted AFTER the raw nonce became public in the first receipt.
      {
        author: {login: 'fro-bot'},
        body: buildResultMarker(makeReceipt({correlationId: 'corr-1', nonce: RAW_NONCE, status: 'failed'})),
      },
    ]
    const resolutions = resolveReceipts([item], comments)
    expect(resolutions.get('item-1')?.terminal).toBe('success')
  })
})

describe('runTrack — receipt-driven resolution (Unit 4 integration)', () => {
  it('happy path: authentic success/noop/failed receipts resolve to completed/completed/failed', async () => {
    const RAW = 'raw-nonce-happy'
    const items: DispatchItem[] = [
      {
        id: 'item-1',
        target: TARGET_A,
        promptHash: 'h1',
        status: 'dispatched',
        correlationId: 'c1',
        epoch: 1000,
        nonceHash: hashNonce(`${RAW}-1`),
      },
      {
        id: 'item-2',
        target: {owner: 'fro-bot', name: 'wiki'},
        promptHash: 'h2',
        status: 'dispatched',
        correlationId: 'c2',
        epoch: 1000,
        nonceHash: hashNonce(`${RAW}-2`),
      },
      {
        id: 'item-3',
        target: {owner: 'fro-bot', name: 'sparkle'},
        promptHash: 'h3',
        status: 'dispatched',
        correlationId: 'c3',
        epoch: 1000,
        nonceHash: hashNonce(`${RAW}-3`),
      },
    ]
    const goalIssue = makeOpenGoal({goal: 'g', items, markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [
        makeReceiptComment(makeReceipt({correlationId: 'c1', nonce: `${RAW}-1`, status: 'success'})),
        makeReceiptComment(makeReceipt({correlationId: 'c2', nonce: `${RAW}-2`, status: 'noop'})),
        makeReceiptComment(makeReceipt({correlationId: 'c3', nonce: `${RAW}-3`, status: 'failed'})),
      ],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [
        gateEntryFor(TARGET_A),
        gateEntryFor({owner: 'fro-bot', name: 'wiki'}),
        gateEntryFor({owner: 'fro-bot', name: 'sparkle'}),
      ],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result.counts.itemsCompleted).toBe(2)
    expect(result.counts.itemsFailed).toBe(1)
    expect(result.counts.goalsClosed).toBe(1)
  })

  it('security: a receipt whose nonce mishashes is rejected — item stays unresolved', async () => {
    const item = makeDispatchedItem()
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: 'forged-nonce', status: 'success'}))],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result.counts.itemsCompleted).toBe(0)
    expect(result.counts.itemsFailed).toBe(0)
    expect(result.counts.goalsClosed).toBe(0)
  })

  it('security: a receipt carrying item A id but item B nonce cannot resolve A', async () => {
    const itemA = makeDispatchedItem({id: 'item-a', correlationId: 'corr-a', nonceHash: hashNonce('nonce-a')})
    const itemB = makeDispatchedItem({id: 'item-b', correlationId: 'corr-b', nonceHash: hashNonce('nonce-b')})
    const goalIssue = makeOpenGoal({goal: 'g', items: [itemA, itemB], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [makeReceiptComment(makeReceipt({correlationId: 'corr-a', nonce: 'nonce-b', status: 'success'}))],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result.counts.itemsCompleted).toBe(0)
  })

  it('error path: non-Fro-Bot-authored comment with a valid-looking marker is ignored', async () => {
    const item = makeDispatchedItem()
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [
        makeReceiptComment(
          makeReceipt({correlationId: 'corr-1', nonce: 'raw-nonce-for-item', status: 'success'}),
          'random-user',
        ),
      ],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result.counts.itemsCompleted).toBe(0)
  })

  it('error path: bot-authored malformed marker for a dispatched item pre-SLA -> unparseable-receipt, non-terminal, goal stays open', async () => {
    const item = makeDispatchedItem()
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [
        {id: 0, login: 'fro-bot', body: '<!-- fro-bot:cross-repo-result {"correlation_id":"corr-1","nonce":"x"} -->'},
      ],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => item.epoch ?? 0, // pre-SLA
    })
    expect(result.counts.itemsNeedsAttention).toBe(1)
    expect(result.counts.goalsClosed).toBe(0)
    const updatedItems = result.counts.itemsNeedsAttention
    expect(updatedItems).toBeGreaterThan(0)
  })

  it('edge case (early-receipt): authentic receipt for a not-yet-confirmed item is retained, resolves once confirmed next pass', async () => {
    const RAW = 'raw-nonce-early'
    // Pass 1: item still 'intent' (no epoch yet) — receipt authentic but item unconfirmed.
    const unconfirmedItem: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'intent',
      correlationId: 'corr-1',
      nonceHash: hashNonce(RAW),
    }
    const goalIssue1 = makeOpenGoal({goal: 'g', items: [unconfirmedItem], markerHash: ''})
    const {octokit: octokit1} = mockOctokitForGoal(goalIssue1, {
      comments: [makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: RAW, status: 'success'}))],
    })
    const result1 = await runTrack({
      octokit: octokit1,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue1],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result1.counts.itemsCompleted).toBe(0)
    expect(result1.counts.goalsClosed).toBe(0)

    // Pass 2: item confirmed (epoch set, status dispatched) — the SAME receipt now resolves it.
    const confirmedItem: DispatchItem = {...unconfirmedItem, status: 'dispatched', epoch: 1000}
    const goalIssue2 = makeOpenGoal({goal: 'g', items: [confirmedItem], markerHash: ''})
    const {octokit: octokit2} = mockOctokitForGoal(goalIssue2, {
      comments: [makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: RAW, status: 'success'}))],
    })
    const result2 = await runTrack({
      octokit: octokit2,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue2],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1000,
    })
    expect(result2.counts.itemsCompleted).toBe(1)
    expect(result2.counts.goalsClosed).toBe(1)
  })

  it('edge case (SLA): no receipt & confirm-age > 24h -> needs-attention/no-receipt; < 24h -> still pending; never-confirmed -> not SLA-aged', async () => {
    const staleItem: DispatchItem = {
      id: 'item-stale',
      target: TARGET_A,
      promptHash: 'h1',
      status: 'dispatched',
      correlationId: 'c-stale',
      epoch: 0,
    }
    const goalStale = makeOpenGoal({goal: 'g1', items: [staleItem], markerHash: ''})
    const {octokit: octokitStale} = mockOctokitForGoal(goalStale)
    const resultStale = await runTrack({
      octokit: octokitStale,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalStale],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => RECEIPT_SLA_MS + 1,
    })
    expect(resultStale.counts.itemsNeedsAttention).toBe(1)
    expect(resultStale.counts.goalsClosed).toBe(0)

    const freshItem: DispatchItem = {
      id: 'item-fresh',
      target: TARGET_A,
      promptHash: 'h2',
      status: 'dispatched',
      correlationId: 'c-fresh',
      epoch: 0,
    }
    const goalFresh = makeOpenGoal({goal: 'g2', items: [freshItem], markerHash: ''})
    const {octokit: octokitFresh} = mockOctokitForGoal(goalFresh)
    const resultFresh = await runTrack({
      octokit: octokitFresh,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalFresh],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => RECEIPT_SLA_MS - 1,
    })
    expect(resultFresh.counts.itemsNeedsAttention).toBe(0)

    const neverConfirmedItem: DispatchItem = {
      id: 'item-never',
      target: TARGET_A,
      promptHash: 'h3',
      status: 'intent',
      correlationId: 'c-never',
    }
    const goalNever = makeOpenGoal({goal: 'g3', items: [neverConfirmedItem], markerHash: ''})
    const {octokit: octokitNever} = mockOctokitForGoal(goalNever)
    const resultNever = await runTrack({
      octokit: octokitNever,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalNever],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => RECEIPT_SLA_MS * 100,
    })
    expect(resultNever.counts.itemsNeedsAttention).toBe(0)
  })

  it('reversible (R10): needs-attention item then a later authentic success resolves to completed, flag cleared', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'needs-attention',
      needsAttentionReason: 'no-receipt',
      correlationId: 'corr-1',
      epoch: 0,
      nonceHash: hashNonce('raw-nonce-reversible'),
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [
        makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: 'raw-nonce-reversible', status: 'success'})),
      ],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 0,
    })
    expect(result.counts.itemsCompleted).toBe(1)
    expect(result.counts.goalsClosed).toBe(1)
  })

  it('earliest-wins/replay (integration): authentic failed then later authentic success stays failed; a later replay never flips', async () => {
    const item = makeDispatchedItem()
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [
        makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: 'raw-nonce-for-item', status: 'failed'})),
        makeReceiptComment(makeReceipt({correlationId: 'corr-1', nonce: 'raw-nonce-for-item', status: 'success'})),
      ],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => undefined,
      now: () => 1_000_000,
    })
    expect(result.counts.itemsFailed).toBe(1)
    expect(result.counts.itemsCompleted).toBe(0)
    expect(result.counts.goalsClosed).toBe(1)
  })

  it('R11: all-terminal goal closes; one needs-attention item keeps it open', async () => {
    const RAW = 'raw-nonce-r11'
    const resolvedItem: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h1',
      status: 'dispatched',
      correlationId: 'c1',
      epoch: 0,
      nonceHash: hashNonce(RAW),
    }
    const staleItem: DispatchItem = {
      id: 'item-2',
      target: {owner: 'fro-bot', name: 'wiki'},
      promptHash: 'h2',
      status: 'dispatched',
      correlationId: 'c2',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [resolvedItem, staleItem], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue, {
      comments: [makeReceiptComment(makeReceipt({correlationId: 'c1', nonce: RAW, status: 'success'}))],
    })
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A), gateEntryFor({owner: 'fro-bot', name: 'wiki'})],
      findRunConclusion: async () => undefined,
      now: () => RECEIPT_SLA_MS + 1,
    })
    expect(result.counts.itemsCompleted).toBe(1)
    expect(result.counts.itemsNeedsAttention).toBe(1)
    expect(result.counts.goalsClosed).toBe(0)
  })
})

describe('counts-only leak check', () => {
  it('runDispatch result contains no repo names or prompt text', async () => {
    const item: DispatchItem = {id: 'item-1', target: TARGET_A, promptHash: 'abcd1234abcd1234', status: 'pending'}
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}
    const decomposition = '- [ ] fro-bot/agent: super secret prompt text'

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async () => undefined,
      nonceSource: () => 'nonce-1',
    })

    const serialized = JSON.stringify(result.counts)
    expect(serialized).not.toContain('agent')
    expect(serialized).not.toContain('secret')
  })
})

// ─── Production collaborator tests ─────────────────────────────────────────────

describe('findRunByCorrelationId / findRunConclusion', () => {
  it('matches a run whose display_title contains the correlation id, ignoring a coincidental non-matching run', async () => {
    const listWorkflowRunsForRepo = vi.fn(async () => ({
      data: {
        workflow_runs: [
          {id: 1, display_title: 'Fro Bot (unrelated-id)', status: 'completed', conclusion: 'success'},
          {id: 2, display_title: 'Fro Bot (corr-real)', status: 'completed', conclusion: 'success'},
        ],
      },
    }))
    const {octokit} = mockOctokit({listWorkflowRunsForRepo})

    const found = await findRunByCorrelationId(octokit)(TARGET_A, 'corr-real')
    expect(found).toBe(true)
    expect(listWorkflowRunsForRepo).toHaveBeenCalledWith(
      expect.objectContaining({owner: TARGET_A.owner, repo: TARGET_A.name, workflow_id: TARGET_WORKFLOW_ID}),
    )
  })

  it('returns false when no run matches the correlation id', async () => {
    const listWorkflowRunsForRepo = vi.fn(async () => ({
      data: {workflow_runs: [{id: 1, display_title: 'Fro Bot (other-id)', status: 'completed', conclusion: 'success'}]},
    }))
    const {octokit} = mockOctokit({listWorkflowRunsForRepo})
    expect(await findRunByCorrelationId(octokit)('corr-missing' as unknown as DispatchTarget, 'corr-missing')).toBe(
      false,
    )
  })

  it('findRunConclusion returns undefined while the matched run is not yet completed', async () => {
    const listWorkflowRunsForRepo = vi.fn(async () => ({
      data: {workflow_runs: [{id: 1, display_title: 'Fro Bot (corr-1)', status: 'in_progress', conclusion: null}]},
    }))
    const {octokit} = mockOctokit({listWorkflowRunsForRepo})
    expect(await findRunConclusion(octokit)(TARGET_A, 'corr-1')).toBeUndefined()
  })

  it('findRunConclusion extracts conclusion once the run has completed', async () => {
    const listWorkflowRunsForRepo = vi.fn(async () => ({
      data: {workflow_runs: [{id: 1, display_title: 'Fro Bot (corr-1)', status: 'completed', conclusion: 'failure'}]},
    }))
    const {octokit} = mockOctokit({listWorkflowRunsForRepo})
    expect(await findRunConclusion(octokit)(TARGET_A, 'corr-1')).toBe('failure')
  })
})

describe('loadOpenGoalIssues', () => {
  it('enumerates open cross-repo-goal issues and resolves each marker', async () => {
    const state = makeState({goal: 'goal-a'})
    const listForRepo = vi.fn(async () => ({data: [{number: 10}]}))
    const listComments = vi.fn(async () => ({
      data: [{id: 1, body: buildMarkerComment(state), user: {login: 'fro-bot'}}],
    }))
    const {octokit} = mockOctokit({listForRepo})
    const patched = {...octokit, rest: {...octokit.rest, issues: {...octokit.rest.issues, listComments}}}

    const result = await loadOpenGoalIssues(patched, REPO)
    expect(listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({owner: REPO.owner, repo: REPO.repo, labels: CROSS_REPO_GOAL_LABEL, state: 'open'}),
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.issueNumber).toBe(10)
    expect(result[0]?.marker.state.goal).toBe('goal-a')
  })

  it('skips issues without a readable bot marker', async () => {
    const listForRepo = vi.fn(async () => ({data: [{number: 11}]}))
    const listComments = vi.fn(async () => ({data: [{id: 1, body: 'no marker here', user: {login: 'fro-bot'}}]}))
    const {octokit} = mockOctokit({listForRepo})
    const patched = {...octokit, rest: {...octokit.rest, issues: {...octokit.rest.issues, listComments}}}
    expect(await loadOpenGoalIssues(patched, REPO)).toHaveLength(0)
  })
})

describe('loadOtherOpenGoalMarkers', () => {
  it('excludes the current issue and returns other open goal markers', async () => {
    const stateOther = makeState({goal: 'goal-other'})
    const listForRepo = vi.fn(async () => ({data: [{number: 42}, {number: 99}]}))
    const listComments = vi.fn(async (params: {issue_number: number}) => ({
      data:
        params.issue_number === 99
          ? [{id: 1, body: buildMarkerComment(stateOther), user: {login: 'fro-bot'}}]
          : [{id: 2, body: buildMarkerComment(makeState({goal: 'current'})), user: {login: 'fro-bot'}}],
    }))
    const {octokit} = mockOctokit({listForRepo})
    const patched = {octokit: {...octokit, rest: {...octokit.rest, issues: {...octokit.rest.issues, listComments}}}}

    const result = await loadOtherOpenGoalMarkers(patched.octokit, REPO, 42)
    expect(result).toHaveLength(1)
    expect(result[0]?.goal).toBe('goal-other')
  })
})

describe('parseTargetTokens', () => {
  it('parses a well-formed owner→token JSON map', () => {
    expect(parseTargetTokens('{"fro-bot":"tok-a","marcusrbrown":"tok-b"}')).toEqual({
      'fro-bot': 'tok-a',
      marcusrbrown: 'tok-b',
    })
  })

  it('returns an empty map for missing, empty, or malformed input', () => {
    expect(parseTargetTokens(undefined)).toEqual({})
    expect(parseTargetTokens('')).toEqual({})
    expect(parseTargetTokens('not json')).toEqual({})
    expect(parseTargetTokens('[]')).toEqual({})
    expect(parseTargetTokens('null')).toEqual({})
  })

  it('drops non-string or empty-string token values', () => {
    expect(parseTargetTokens('{"fro-bot":"","marcusrbrown":42,"good":"tok"}')).toEqual({good: 'tok'})
  })

  it('returns an empty map when every owner mint failed (both tokens empty)', () => {
    // Mirrors the workflow's inline JSON when both per-owner mint steps
    // continue-on-error past a failure (App not installed on either owner).
    expect(parseTargetTokens('{"fro-bot":"","marcusrbrown":""}')).toEqual({})
  })
})

describe('createTargetClientResolver — fail-closed owner routing', () => {
  it('throws for an owner with no minted client', () => {
    const {octokit} = mockOctokit()
    const resolver = createTargetClientResolver(new Map([['fro-bot', octokit]]))
    expect(resolver.hasTargetToken('fro-bot')).toBe(true)
    expect(resolver.hasTargetToken('marcusrbrown')).toBe(false)
    expect(() => resolver.targetClientFor('marcusrbrown')).toThrow(/no dispatch token minted/)
  })
})

describe('owner-aware dispatch/track routing — fro-bot and marcusrbrown are separate App installations', () => {
  it('routes a marcusrbrown target createWorkflowDispatch through the marcusrbrown client, not the control-plane client', async () => {
    const originalEnv = {...process.env}
    const {writeFile, mkdtemp} = await import('node:fs/promises')
    const {tmpdir} = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'cross-repo-dispatch-owner-'))
    const eventPath = path.join(dir, 'event.json')
    await writeFile(eventPath, JSON.stringify(makeLabeledEvent()))

    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_EVENT_PATH = eventPath
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      const decomposition = makeDecompositionBody([
        {owner: 'marcusrbrown', name: 'sparkle', prompt: 'do the marcusrbrown thing'},
      ])
      const {octokit: controlPlaneOctokit} = mockOctokit({
        comments: [{id: 1, body: decomposition, login: 'fro-bot'}],
      })

      const controlPlaneDispatch = vi.fn(async (_params: unknown) => ({}))
      const marcusrbrownDispatch = vi.fn(async (_params: unknown) => ({}))

      const controlPlane: CrossRepoDispatchOctokitClient = {
        ...controlPlaneOctokit,
        rest: {
          ...controlPlaneOctokit.rest,
          actions: {...controlPlaneOctokit.rest.actions, createWorkflowDispatch: controlPlaneDispatch},
        },
      }
      const marcusrbrownClient: CrossRepoDispatchOctokitClient = {
        ...controlPlaneOctokit,
        rest: {
          ...controlPlaneOctokit.rest,
          actions: {...controlPlaneOctokit.rest.actions, createWorkflowDispatch: marcusrbrownDispatch},
        },
      }

      await runDispatchCli(
        async () => controlPlane,
        async () =>
          createTargetClientResolver(
            new Map([
              ['fro-bot', controlPlane],
              ['marcusrbrown', marcusrbrownClient],
            ]),
          ),
      )

      expect(marcusrbrownDispatch).toHaveBeenCalledOnce()
      expect(marcusrbrownDispatch).toHaveBeenCalledWith(
        expect.objectContaining({owner: 'marcusrbrown', repo: 'sparkle'}),
      )
      expect(controlPlaneDispatch).not.toHaveBeenCalled()
    } finally {
      process.env = originalEnv
    }
  })

  it("dispatches a mixed goal (fro-bot + marcusrbrown targets) via each target owner's own client", async () => {
    const originalEnv = {...process.env}
    const {writeFile, mkdtemp} = await import('node:fs/promises')
    const {tmpdir} = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'cross-repo-dispatch-mixed-'))
    const eventPath = path.join(dir, 'event.json')
    await writeFile(eventPath, JSON.stringify(makeLabeledEvent()))

    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_EVENT_PATH = eventPath
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      const decomposition = makeDecompositionBody([
        {owner: TARGET_A.owner, name: TARGET_A.name, prompt: 'do the fro-bot thing'},
        {owner: TARGET_MARCUSRBROWN.owner, name: TARGET_MARCUSRBROWN.name, prompt: 'do the marcusrbrown thing'},
      ])
      const {octokit: controlPlaneOctokit} = mockOctokit({
        comments: [{id: 1, body: decomposition, login: 'fro-bot'}],
      })

      const froBotDispatch = vi.fn(async (_params: unknown) => ({}))
      const marcusrbrownDispatch = vi.fn(async (_params: unknown) => ({}))

      const froBotClient: CrossRepoDispatchOctokitClient = {
        ...controlPlaneOctokit,
        rest: {
          ...controlPlaneOctokit.rest,
          actions: {...controlPlaneOctokit.rest.actions, createWorkflowDispatch: froBotDispatch},
        },
      }
      const marcusrbrownClient: CrossRepoDispatchOctokitClient = {
        ...controlPlaneOctokit,
        rest: {
          ...controlPlaneOctokit.rest,
          actions: {...controlPlaneOctokit.rest.actions, createWorkflowDispatch: marcusrbrownDispatch},
        },
      }

      await runDispatchCli(
        async () => froBotClient,
        async () =>
          createTargetClientResolver(
            new Map([
              ['fro-bot', froBotClient],
              ['marcusrbrown', marcusrbrownClient],
            ]),
          ),
      )

      expect(froBotDispatch).toHaveBeenCalledOnce()
      expect(froBotDispatch).toHaveBeenCalledWith(expect.objectContaining({owner: TARGET_A.owner, repo: TARGET_A.name}))
      expect(marcusrbrownDispatch).toHaveBeenCalledOnce()
      expect(marcusrbrownDispatch).toHaveBeenCalledWith(
        expect.objectContaining({owner: TARGET_MARCUSRBROWN.owner, repo: TARGET_MARCUSRBROWN.name}),
      )
    } finally {
      process.env = originalEnv
    }
  })

  it('an eligible target owner with no minted token is blocked; other targets in the same goal still dispatch', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'abcd1234abcd1234',
      status: 'pending',
    }
    const missingTokenItem: DispatchItem = {
      id: 'item-2',
      target: TARGET_MARCUSRBROWN,
      promptHash: 'ffff5678ffff5678',
      status: 'pending',
    }
    const decomposition = makeDecompositionBody([
      {owner: TARGET_A.owner, name: TARGET_A.name, prompt: 'do the fro-bot thing'},
      {owner: TARGET_MARCUSRBROWN.owner, name: TARGET_MARCUSRBROWN.name, prompt: 'do the marcusrbrown thing'},
    ])
    const state: GoalState = {
      goal: 'goal-mixed',
      items: [
        {...item, promptHash: extractPromptHash(decomposition, TARGET_A)},
        {...missingTokenItem, promptHash: extractPromptHash(decomposition, TARGET_MARCUSRBROWN)},
      ],
      markerHash: '',
    }
    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A), gateEntryFor(TARGET_MARCUSRBROWN)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-owner-gap',
      // Only fro-bot has a minted token — marcusrbrown is eligible per the
      // registry gate but ops forgot to mint its dispatch token.
      hasTargetToken: owner => owner === 'fro-bot',
    })

    expect(createWorkflowDispatch).toHaveBeenCalledOnce()
    expect(createWorkflowDispatch).toHaveBeenCalledWith(expect.objectContaining({owner: 'fro-bot', repo: 'agent'}))
    expect(result.counts.dispatched).toBe(1)

    const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const marcusrbrownItem = finalMarker?.state.items.find(candidate => candidate.id === 'item-2')
    expect(marcusrbrownItem?.status).toBe('blocked')
  })

  it('all eligible targets blocked when the token map is empty (both owner mints failed); no crash, no dispatches', async () => {
    const decomposition = makeDecompositionBody([
      {owner: TARGET_A.owner, name: TARGET_A.name, prompt: 'do the fro-bot thing'},
      {owner: TARGET_MARCUSRBROWN.owner, name: TARGET_MARCUSRBROWN.name, prompt: 'do the marcusrbrown thing'},
    ])
    const state: GoalState = {
      goal: 'goal-all-blocked',
      items: [
        {id: 'item-1', target: TARGET_A, promptHash: extractPromptHash(decomposition, TARGET_A), status: 'pending'},
        {
          id: 'item-2',
          target: TARGET_MARCUSRBROWN,
          promptHash: extractPromptHash(decomposition, TARGET_MARCUSRBROWN),
          status: 'pending',
        },
      ],
      markerHash: '',
    }

    const {octokit, comments} = mockOctokit()
    comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
    seedMarkerComment(comments, state)

    const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))

    const result = await runDispatch({
      octokit,
      event: makeLabeledEvent(),
      repo: REPO,
      approveLabel: 'dispatch-approved',
      loadRegistry: async () => [gateEntryFor(TARGET_A), gateEntryFor(TARGET_MARCUSRBROWN)],
      loadOtherOpenGoalMarkers: async () => [],
      findRunByCorrelationId: async () => false,
      createWorkflowDispatch: async params => {
        await createWorkflowDispatch(params)
      },
      nonceSource: () => 'nonce-all-blocked',
      // Simulates parseTargetTokens('{"fro-bot":"","marcusrbrown":""}') → {}
      // → every owner lookup misses → every eligible item blocked.
      hasTargetToken: () => false,
    })

    expect(createWorkflowDispatch).not.toHaveBeenCalled()
    expect(result.counts.dispatched).toBe(0)
    expect(result.counts.blocked).toBe(2)
  })

  it('track: listWorkflowRunsForRepo (diagnostic run-lookup) for a marcusrbrown target goes through the marcusrbrown client', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_MARCUSRBROWN,
      promptHash: 'abcd1234abcd1234',
      status: 'dispatched',
      correlationId: 'corr-track-owner-1',
      // Past SLA with no receipt so the diagnostic run-lookup actually fires
      // (Unit 5: it is never consulted for a non-needs-attention item).
      epoch: 0,
    }
    const goalIssue: OpenGoalIssue = {
      issueNumber: 77,
      marker: serializeMarker({goal: 'goal-track', items: [item], markerHash: ''}),
    }

    const {octokit: controlPlaneOctokit} = mockOctokit()
    const listForRepo = vi.fn(async () => ({data: [{number: 77}]}))
    const controlPlaneListComments = vi.fn(async () => ({
      data: [
        {
          id: 1,
          body: buildMarkerComment({...goalIssue.marker.state, markerHash: goalIssue.marker.hash}),
          user: {login: 'fro-bot'},
        },
      ],
    }))
    const controlPlane: CrossRepoDispatchOctokitClient = {
      ...controlPlaneOctokit,
      rest: {
        ...controlPlaneOctokit.rest,
        issues: {...controlPlaneOctokit.rest.issues, listForRepo, listComments: controlPlaneListComments},
      },
    }

    const froBotListWorkflowRunsForRepo = vi.fn(async () => ({data: {workflow_runs: []}}))
    const froBotClient: CrossRepoDispatchOctokitClient = {
      ...controlPlaneOctokit,
      rest: {
        ...controlPlaneOctokit.rest,
        actions: {...controlPlaneOctokit.rest.actions, listWorkflowRunsForRepo: froBotListWorkflowRunsForRepo},
      },
    }
    const marcusrbrownListWorkflowRunsForRepo = vi.fn(async () => ({data: {workflow_runs: []}}))
    const marcusrbrownClient: CrossRepoDispatchOctokitClient = {
      ...controlPlaneOctokit,
      rest: {
        ...controlPlaneOctokit.rest,
        actions: {
          ...controlPlaneOctokit.rest.actions,
          listWorkflowRunsForRepo: marcusrbrownListWorkflowRunsForRepo,
        },
      },
    }

    const originalEnv = {...process.env}
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      await runTrackCli(
        async () => controlPlane,
        async () =>
          createTargetClientResolver(
            new Map([
              ['fro-bot', froBotClient],
              ['marcusrbrown', marcusrbrownClient],
            ]),
          ),
      )
    } finally {
      process.env = originalEnv
    }

    expect(marcusrbrownListWorkflowRunsForRepo).toHaveBeenCalledWith(
      expect.objectContaining({owner: TARGET_MARCUSRBROWN.owner, repo: TARGET_MARCUSRBROWN.name}),
    )
    expect(froBotListWorkflowRunsForRepo).not.toHaveBeenCalled()
  })
})

describe('CLI wiring — real collaborators, not stubs', () => {
  it('runTrackCli invokes octokit issue enumeration (wired loadOpenGoalIssues)', async () => {
    const originalEnv = {...process.env}
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      const listForRepo = vi.fn(async () => ({data: []}))
      const {octokit} = mockOctokit({listForRepo})
      await runTrackCli(async () => octokit, singleOwnerResolver(octokit))
      expect(listForRepo).toHaveBeenCalled()
    } finally {
      process.env = originalEnv
    }
  })

  it('runDispatchCli wires a real findRunByCorrelationId consulted on an intent-resume path', async () => {
    const originalEnv = {...process.env}
    const {writeFile, mkdtemp} = await import('node:fs/promises')
    const {tmpdir} = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'cross-repo-dispatch-'))
    const eventPath = path.join(dir, 'event.json')
    await writeFile(
      eventPath,
      JSON.stringify({label: {name: 'dispatch-approved'}, sender: {login: REQUIRED_APPROVER}, issue: {number: 42}}),
    )

    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_EVENT_PATH = eventPath
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      const item: DispatchItem = {
        id: 'item-1',
        target: TARGET_A,
        promptHash: 'abcd1234abcd1234',
        status: 'intent',
        correlationId: 'corr-resume-1',
        nonceHash: 'nonce-hash-1',
      }
      const state: GoalState = {
        goal: 'goal-1',
        items: [item],
        approvalFingerprint: computeApprovalFingerprint([item]),
        markerHash: '',
      }
      const decomposition = '- [ ] fro-bot/agent: do the thing'
      const {octokit, comments} = mockOctokit()
      comments.push({id: 1, body: decomposition, login: 'marcusrbrown'})
      seedMarkerComment(comments, state)

      const listWorkflowRunsForRepo = vi.fn(async () => ({data: {workflow_runs: []}}))
      const patched = {
        ...octokit,
        rest: {...octokit.rest, actions: {...octokit.rest.actions, listWorkflowRunsForRepo}},
      }

      await runDispatchCli(async () => patched, singleOwnerResolver(patched))
      expect(listWorkflowRunsForRepo).toHaveBeenCalledWith(
        expect.objectContaining({owner: TARGET_A.owner, repo: TARGET_A.name}),
      )
    } finally {
      process.env = originalEnv
    }
  })
})

describe('golden path — real production composition (runDispatchCli then runTrackCli)', () => {
  // Captured shape of a real planner comment: prose intro, a checklist, prose
  // footer, and a `<details><summary>Run Summary</summary></details>` block.
  // This is the exact structure that broke the strict line-by-line parser —
  // this test drives the REAL production wiring (runDispatchCli/runTrackCli),
  // not runDispatch with hand-picked collaborators, so a prompt/parser
  // contract mismatch here can't hide behind a unit-tested island again.
  const PLANNER_COMMENT = [
    'This is a clean cross-repo goal: confirm each target README opens with an H1 ... (prose intro paragraph)',
    '',
    'Both targets resolve to valid owner-repo entries ... (second prose paragraph)',
    '',
    'Proposed per-repo work items:',
    '',
    '- [ ] marcusrbrown/sparkle: Read README.md at the repo root. If the first non-blank line is already a top-level # H1, make no change. If no H1 is present, insert a minimal one (# sparkle) as the first line. Open a PR titled docs: ensure README H1 heading; do not touch other content.',
    '- [ ] marcusrbrown/renovate-config: Read README.md at the repo root. If absent, insert # renovate-config as the first line. Open a PR titled docs: ensure README H1 heading; do not touch other content.',
    '',
    'This is a proposal only—no dispatch happened and this run has no dispatch capability.',
    '',
    '---',
    '',
    '<!-- fro-bot-agent -->',
    '<details>',
    '<summary>Run Summary</summary>',
    '',
    '| Field | Value |',
    '|-------|-------|',
    '| Event | issues |',
    '| Repository | fro-bot/.github |',
    '| Run ID | 0000000000 |',
    '| Cache | hit |',
    '',
    '</details>',
  ].join('\n')

  const GOLDEN_TARGETS: DispatchTarget[] = [
    {owner: 'marcusrbrown', name: 'sparkle'},
    {owner: 'marcusrbrown', name: 'renovate-config'},
  ]

  it('parses the real planner comment shape, seeds+gates+dispatches both items, then closes the issue on success', async () => {
    const originalEnv = {...process.env}
    const {writeFile, mkdtemp} = await import('node:fs/promises')
    const {tmpdir} = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'cross-repo-dispatch-golden-'))
    const eventPath = path.join(dir, 'event.json')
    await writeFile(
      eventPath,
      JSON.stringify({
        label: {name: 'dispatch-approved'},
        sender: {login: REQUIRED_APPROVER},
        issue: {number: 42},
      }),
    )

    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_EVENT_PATH = eventPath
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''

    try {
      // ─── Phase 1: runDispatchCli against a fake octokit factory ──────────
      const {octokit, comments} = mockOctokit()
      comments.push({id: 1, body: PLANNER_COMMENT, login: 'fro-bot'})

      const createComment = vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
        const comment = {id: comments.length + 1, body: params.body, login: 'fro-bot'}
        comments.push(comment)
        return {data: {id: comment.id}}
      })
      const updateComment = vi.fn(async (params: {comment_id: number; body: string}) => {
        const existing = comments.find(c => c.id === params.comment_id)
        if (existing !== undefined) existing.body = params.body
        return {}
      })
      const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))
      const listForRepo = vi.fn(async () => ({data: [{number: 42}]}))

      const dispatchOctokit = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, createComment, updateComment, listForRepo},
          actions: {...octokit.rest.actions, createWorkflowDispatch},
        },
      }

      await runDispatchCli(async () => dispatchOctokit, singleOwnerResolver(dispatchOctokit))

      expect(createComment).toHaveBeenCalledOnce()
      const seededBody = createComment.mock.calls[0]?.[0]?.body as string
      expect(seededBody.startsWith(`<!-- ${MARKER_PREFIX}`)).toBe(true)

      expect(createWorkflowDispatch).toHaveBeenCalledTimes(2)
      for (const target of GOLDEN_TARGETS) {
        const call = createWorkflowDispatch.mock.calls.find(
          c =>
            (c[0] as {owner: string; repo: string}).owner === target.owner &&
            (c[0] as {repo: string}).repo === target.name,
        )
        expect(call).toBeDefined()
      }
      const sparkleCall = createWorkflowDispatch.mock.calls.find(
        c => (c[0] as {repo: string}).repo === 'sparkle',
      )?.[0] as {inputs: {prompt: string}} | undefined
      expect(sparkleCall?.inputs.prompt).toContain('insert a minimal one (# sparkle)')

      const renovateCall = createWorkflowDispatch.mock.calls.find(
        c => (c[0] as {repo: string}).repo === 'renovate-config',
      )?.[0] as {inputs: {prompt: string}} | undefined
      expect(renovateCall?.inputs.prompt).toContain('insert # renovate-config')

      // dispatch result is what runDispatchCli wrote via writeResult (stdout);
      // re-derive counts from the marker state left on the issue instead.
      const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
      expect(finalMarker).not.toBeNull()
      const dispatchedItems = finalMarker?.state.items.filter(item => item.status === 'dispatched') ?? []
      expect(dispatchedItems).toHaveLength(2)

      // ─── Phase 2: runTrackCli against the seeded+dispatched marker ───────
      // Unit 5: the receipt is the SOLE completion oracle — run-lookup no
      // longer resolves terminal state. Simulate each worker posting an
      // authentic receipt (extracting the correlation id + raw nonce that
      // were embedded in its dispatch prompt, exactly as a real worker would
      // read them) instead of relying on the (now diagnostic-only) run/PR path.
      for (const target of GOLDEN_TARGETS) {
        const call = createWorkflowDispatch.mock.calls.find(c => (c[0] as {repo: string}).repo === target.name)?.[0] as
          {inputs: {prompt: string}} | undefined
        const prompt = call?.inputs.prompt ?? ''
        const correlationId = /correlation_id: (\S+)/.exec(prompt)?.[1]
        const nonce = /^nonce: (\S+)$/m.exec(prompt)?.[1]
        expect(correlationId).toBeDefined()
        expect(nonce).toBeDefined()
        comments.push({
          id: comments.length + 1,
          login: 'fro-bot',
          body: buildResultMarker({
            correlationId: correlationId as string,
            nonce: nonce as string,
            status: 'success',
            summary: `Confirmed README H1 for ${target.name}.`,
          }),
        })
      }

      // Diagnostic run-lookup collaborator: still wired (R8 keeps `actions:
      // read`), but never consulted here since every item resolves from its
      // receipt before it can ever become `needs-attention`/`no-receipt`.
      const listWorkflowRunsForRepo = vi.fn(async () => ({data: {workflow_runs: []}}))
      const update = vi.fn(async (_params: unknown) => ({data: {}}))

      const trackListForRepo = vi.fn(async () => ({data: [{number: 42}]}))
      const trackOctokit = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, listForRepo: trackListForRepo, update},
          actions: {...octokit.rest.actions, listWorkflowRunsForRepo},
        },
      }

      await runTrackCli(async () => trackOctokit, singleOwnerResolver(trackOctokit))
      expect(listWorkflowRunsForRepo).not.toHaveBeenCalled()

      expect(update).toHaveBeenCalledWith(expect.objectContaining({issue_number: 42, state: 'closed'}))

      const closedMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
      // A no-op receipt closes its item too, same as success (R7).
      expect(closedMarker?.state.items.find(item => item.target.name === 'sparkle')?.status).toBe('completed')
      expect(closedMarker?.state.items.find(item => item.target.name === 'renovate-config')?.status).toBe('completed')
    } finally {
      process.env = originalEnv
    }
  })

  it('hostile: a cross-item forgery receipt (correct correlation id, wrong/guessed nonce) never resolves the item — real receipt still can', async () => {
    // This is the standing anti-recurrence contract for R6/R6c: an attacker
    // who reads the PUBLIC marker only ever learns `nonceHash`, never the raw
    // nonce, so a forged receipt can only ever GUESS at the raw nonce. This
    // test drives the real dispatch->track composition and proves the guess
    // never moves state, then proves the genuine receipt (extracted from the
    // dispatch prompt exactly as a real worker would read it) still resolves
    // the item afterward — forgery attempts don't poison the item permanently.
    const originalEnv = {...process.env}
    const {writeFile, mkdtemp} = await import('node:fs/promises')
    const {tmpdir} = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'cross-repo-dispatch-golden-hostile-'))
    const eventPath = path.join(dir, 'event.json')
    await writeFile(
      eventPath,
      JSON.stringify({
        label: {name: 'dispatch-approved'},
        sender: {login: REQUIRED_APPROVER},
        issue: {number: 42},
      }),
    )

    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_EVENT_PATH = eventPath
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''

    try {
      const {octokit, comments} = mockOctokit()
      comments.push({id: 1, body: PLANNER_COMMENT, login: 'fro-bot'})

      const createComment = vi.fn(async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
        const comment = {id: comments.length + 1, body: params.body, login: 'fro-bot'}
        comments.push(comment)
        return {data: {id: comment.id}}
      })
      const updateComment = vi.fn(async (params: {comment_id: number; body: string}) => {
        const existing = comments.find(c => c.id === params.comment_id)
        if (existing !== undefined) existing.body = params.body
        return {}
      })
      const createWorkflowDispatch = vi.fn(async (_params: unknown) => ({}))
      const listForRepo = vi.fn(async () => ({data: [{number: 42}]}))

      const dispatchOctokit = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, createComment, updateComment, listForRepo},
          actions: {...octokit.rest.actions, createWorkflowDispatch},
        },
      }

      await runDispatchCli(async () => dispatchOctokit, singleOwnerResolver(dispatchOctokit))
      expect(createWorkflowDispatch).toHaveBeenCalledTimes(2)

      const correlationIdFor = (repoName: string): string => {
        const call = createWorkflowDispatch.mock.calls.find(c => (c[0] as {repo: string}).repo === repoName)?.[0] as
          {inputs: {prompt: string}} | undefined
        const prompt = call?.inputs.prompt ?? ''
        const correlationId = /correlation_id: (\S+)/.exec(prompt)?.[1]
        expect(correlationId).toBeDefined()
        return correlationId as string
      }

      // ─── Phase 2a: post ONLY forged receipts (correct correlation id, a
      // guessed/wrong raw nonce — the only thing a forger reading the public
      // marker could ever attempt, since the marker stores nonceHash, not the
      // raw nonce). Neither item may resolve.
      for (const target of GOLDEN_TARGETS) {
        comments.push({
          id: comments.length + 1,
          login: 'fro-bot',
          body: buildResultMarker({
            correlationId: correlationIdFor(target.name),
            nonce: 'forged-guessed-nonce-does-not-hash',
            status: 'success',
            summary: 'Forged: I read the marker and guessed at a nonce.',
          }),
        })
      }

      const listWorkflowRunsForRepoHostile = vi.fn(async () => ({data: {workflow_runs: []}}))
      const updateHostile = vi.fn(async (_params: unknown) => ({data: {}}))
      const trackListForRepoHostile = vi.fn(async () => ({data: [{number: 42}]}))
      const trackOctokitHostile = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, listForRepo: trackListForRepoHostile, update: updateHostile},
          actions: {...octokit.rest.actions, listWorkflowRunsForRepo: listWorkflowRunsForRepoHostile},
        },
      }
      await runTrackCli(async () => trackOctokitHostile, singleOwnerResolver(trackOctokitHostile))

      expect(updateHostile).not.toHaveBeenCalledWith(expect.objectContaining({state: 'closed'}))
      const markerAfterForgery = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
      expect(markerAfterForgery?.state.items.every(item => item.status !== 'completed')).toBe(true)
      expect(markerAfterForgery?.state.items.every(item => item.status !== 'failed')).toBe(true)

      // ─── Phase 2b: the REAL workers post their genuine receipts (correct
      // raw nonce extracted from their own dispatch prompt). The earlier
      // forgery attempts must not have poisoned the item — it resolves now.
      for (const target of GOLDEN_TARGETS) {
        const call = createWorkflowDispatch.mock.calls.find(c => (c[0] as {repo: string}).repo === target.name)?.[0] as
          {inputs: {prompt: string}} | undefined
        const prompt = call?.inputs.prompt ?? ''
        const correlationId = /correlation_id: (\S+)/.exec(prompt)?.[1]
        const nonce = /^nonce: (\S+)$/m.exec(prompt)?.[1]
        comments.push({
          id: comments.length + 1,
          login: 'fro-bot',
          body: buildResultMarker({
            correlationId: correlationId as string,
            nonce: nonce as string,
            status: 'success',
            summary: `Confirmed README H1 for ${target.name}.`,
          }),
        })
      }

      const listWorkflowRunsForRepoReal = vi.fn(async () => ({data: {workflow_runs: []}}))
      const updateReal = vi.fn(async (_params: unknown) => ({data: {}}))
      const trackListForRepoReal = vi.fn(async () => ({data: [{number: 42}]}))
      const trackOctokitReal = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, listForRepo: trackListForRepoReal, update: updateReal},
          actions: {...octokit.rest.actions, listWorkflowRunsForRepo: listWorkflowRunsForRepoReal},
        },
      }
      await runTrackCli(async () => trackOctokitReal, singleOwnerResolver(trackOctokitReal))

      expect(updateReal).toHaveBeenCalledWith(expect.objectContaining({issue_number: 42, state: 'closed'}))
      const finalMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
      expect(finalMarker?.state.items.every(item => item.status === 'completed')).toBe(true)
    } finally {
      process.env = originalEnv
    }
  })

  it('early-receipt: a genuine receipt posted before the item is confirmed is retained, then resolves once confirmed (real runTrackCli composition)', async () => {
    const originalEnv = {...process.env}
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.CROSS_REPO_DISPATCH_RESULT_PATH = ''
    try {
      const RAW = 'raw-nonce-early-golden'
      const target = GOLDEN_TARGETS[0] as DispatchTarget

      // Pass 1: item is still 'intent' — confirmedAt (`epoch`) has not landed
      // yet, but `correlationId`/`nonceHash` were already persisted at the
      // preceding intent write (mirroring the real two-phase dispatch). A
      // fast worker's genuine receipt arrives before confirm.
      const unconfirmedItem: DispatchItem = {
        id: 'item-1',
        target,
        promptHash: 'h',
        status: 'intent',
        correlationId: 'corr-early-golden',
        nonceHash: hashNonce(RAW),
      }
      const goalUnconfirmed = makeOpenGoal({goal: 'g-early', items: [unconfirmedItem], markerHash: ''})
      const {octokit: octokit1, comments: comments1} = mockOctokitForGoal(goalUnconfirmed, {
        comments: [
          makeReceiptComment(makeReceipt({correlationId: 'corr-early-golden', nonce: RAW, status: 'success'})),
        ],
        listForRepo: vi.fn(async () => ({data: [{number: goalUnconfirmed.issueNumber}]})),
      })
      await runTrackCli(async () => octokit1, singleOwnerResolver(octokit1))

      const markerAfterPass1 = selectStateMarker(comments1.map(c => ({author: {login: c.login}, body: c.body})))
      expect(markerAfterPass1?.state.items.find(candidate => candidate.id === 'item-1')?.status).toBe('intent')

      // Pass 2: confirm has now landed (status 'dispatched', epoch set). The
      // SAME genuine receipt — never dropped — resolves the item this pass.
      const confirmedItem: DispatchItem = {...unconfirmedItem, status: 'dispatched', epoch: 0}
      const goalConfirmed = makeOpenGoal({goal: 'g-early', items: [confirmedItem], markerHash: ''})
      const {octokit: octokit2, comments: comments2} = mockOctokitForGoal(goalConfirmed, {
        comments: [
          makeReceiptComment(makeReceipt({correlationId: 'corr-early-golden', nonce: RAW, status: 'success'})),
        ],
        listForRepo: vi.fn(async () => ({data: [{number: goalConfirmed.issueNumber}]})),
      })
      await runTrackCli(async () => octokit2, singleOwnerResolver(octokit2))

      const markerAfterPass2 = selectStateMarker(comments2.map(c => ({author: {login: c.login}, body: c.body})))
      expect(markerAfterPass2?.state.items.find(candidate => candidate.id === 'item-1')?.status).toBe('completed')
    } finally {
      process.env = originalEnv
    }
  })

  it('SLA + diagnostic: a no-receipt item past 24h surfaces needs-attention, annotated ran-no-report vs never-ran (production runTrack composition)', async () => {
    const target = GOLDEN_TARGETS[0] as DispatchTarget
    const itemRan: DispatchItem = {
      id: 'item-ran',
      target,
      promptHash: 'h1',
      status: 'dispatched',
      correlationId: 'c-ran-golden',
      epoch: 0,
    }
    const itemNeverRan: DispatchItem = {
      id: 'item-never',
      target,
      promptHash: 'h2',
      status: 'dispatched',
      correlationId: 'c-never-golden',
      epoch: 0,
    }
    const goalIssue = makeOpenGoal({goal: 'g-sla-golden', items: [itemRan, itemNeverRan], markerHash: ''})
    const {octokit, comments} = mockOctokitForGoal(goalIssue)
    const findRunConclusion = vi.fn(async (_t: DispatchTarget, correlationId: string) =>
      correlationId === 'c-ran-golden' ? ('success' as const) : undefined,
    )

    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(target)],
      findRunConclusion,
      now: () => RECEIPT_SLA_MS + 1,
    })

    // No receipt past SLA -> needs-attention for both; goal stays open (R9,
    // R11). The diagnostic run-lookup ONLY annotates a reason, never flips
    // either item terminal (R8: run-lookup is non-authoritative).
    expect(result.counts.itemsNeedsAttention).toBe(2)
    expect(result.counts.itemsCompleted).toBe(0)
    expect(result.counts.goalsClosed).toBe(0)

    const marker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
    const ran = marker?.state.items.find(candidate => candidate.id === 'item-ran')
    const neverRan = marker?.state.items.find(candidate => candidate.id === 'item-never')
    expect(ran?.status).toBe('needs-attention')
    expect(ran?.needsAttentionReason).toBe('no-receipt')
    expect(ran?.noReceiptDiagnostic).toBe('ran-no-report')
    expect(neverRan?.status).toBe('needs-attention')
    expect(neverRan?.needsAttentionReason).toBe('no-receipt')
    expect(neverRan?.noReceiptDiagnostic).toBe('never-ran')
  })
})
