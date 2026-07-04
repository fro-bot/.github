import type {
  CrossRepoDispatchOctokitClient,
  CrossRepoResult,
  DispatchItem,
  DispatchTarget,
  GateEntry,
  GoalState,
  LabeledEventPayload,
  OpenGoalIssue,
  PrLookupResult,
  TrackerComment,
} from './cross-repo-dispatch.ts'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'

import {
  buildMarkerComment,
  buildResultMarker,
  computeApprovalFingerprint,
  createTargetClientResolver,
  CROSS_REPO_GOAL_LABEL,
  extractItemPrompts,
  extractMarker,
  findBotAuthoredPrs,
  findRunByCorrelationId,
  findRunConclusion,
  gateTarget,
  loadOpenGoalIssues,
  loadOtherOpenGoalMarkers,
  MARKER_PREFIX,
  MAX_ITEMS_PER_GOAL,
  parseDecomposition,
  parseResult,
  parseTargetTokens,
  planDispatch,
  planSnapshot,
  REQUIRED_APPROVER,
  resolveItemTerminalState,
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

describe('resolveItemTerminalState — precedence table', () => {
  it('gate-block takes precedence over everything', () => {
    expect(resolveItemTerminalState({gateBlocked: true, runConclusion: 'success'})).toBe('blocked')
  })

  it('run failure resolves to failed', () => {
    expect(resolveItemTerminalState({runConclusion: 'failure'})).toBe('failed')
  })

  it('no run conclusion yet resolves to dispatched (non-terminal)', () => {
    expect(resolveItemTerminalState({})).toBe('dispatched')
  })

  it('success with no PR (no-op success) resolves to completed', () => {
    expect(resolveItemTerminalState({runConclusion: 'success', prs: []})).toBe('completed')
  })

  it('success with one merged bot PR resolves to completed', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [{merged: true, closed: true, authorIsBot: true}],
      }),
    ).toBe('completed')
  })

  it('success with only closed-unmerged bot PRs resolves to failed', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [{merged: false, closed: true, authorIsBot: true}],
      }),
    ).toBe('failed')
  })

  it('success with a still-open bot PR resolves to dispatched (non-terminal)', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [{merged: false, closed: false, authorIsBot: true}],
      }),
    ).toBe('dispatched')
  })

  it('multi-PR: terminal only when all are terminal, completed if any merged', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [
          {merged: false, closed: true, authorIsBot: true},
          {merged: true, closed: true, authorIsBot: true},
        ],
      }),
    ).toBe('completed')
  })

  it('multi-PR: all closed-unmerged resolves to failed', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [
          {merged: false, closed: true, authorIsBot: true},
          {merged: false, closed: true, authorIsBot: true},
        ],
      }),
    ).toBe('failed')
  })

  it('a forged non-bot PR is ignored — no-op success completes', () => {
    expect(
      resolveItemTerminalState({
        runConclusion: 'success',
        prs: [{merged: true, closed: true, authorIsBot: false}],
      }),
    ).toBe('completed')
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
  it('applies terminal resolution per dispatched item and flags allTerminal', () => {
    const state = makeState({items: [makeItem({id: 'a', status: 'dispatched'})], markerHash: 'old'})
    const result = planSnapshot({state, signals: {a: {runConclusion: 'success', prs: []}}})
    expect(result.state.items[0]?.status).toBe('completed')
    expect(result.allTerminal).toBe(true)
    expect(result.shouldWrite).toBe(true)
  })

  it('stays open when not all items are terminal', () => {
    const state = makeState({
      items: [makeItem({id: 'a', status: 'dispatched'}), makeItem({id: 'b', status: 'dispatched'})],
      markerHash: 'old',
    })
    const result = planSnapshot({state, signals: {a: {runConclusion: 'success', prs: []}}})
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
    issuesAndPullRequests?: ReturnType<typeof vi.fn>
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
      search: {
        issuesAndPullRequests: (overrides.issuesAndPullRequests ??
          vi.fn(async () => ({
            data: {items: []},
          }))) as CrossRepoDispatchOctokitClient['rest']['search']['issuesAndPullRequests'],
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
        inputs: {prompt: string; correlation_id: string}
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
      expect(call?.inputs.prompt).toBe(`do work in ${target.name}`)
    }
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
        inputs: {prompt: string; correlation_id: string}
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
      expect(call?.inputs.prompt).toBe(`do work in ${target.name}`)
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
      nonce: 'nonce-1',
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
        items: [{...item, nonce: `spin-${spin}`}],
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

describe('runTrack — terminal precedence and closure', () => {
  it('picks the correct run by correlation-id when a coincidental run shares the epoch window', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'abcd1234abcd1234',
      status: 'dispatched',
      correlationId: 'corr-real',
      epoch: 1000,
    }
    const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}
    const goalIssue = makeOpenGoal(state)

    const findRunConclusion = vi.fn(async (_target: DispatchTarget, correlationId: string) =>
      correlationId === 'corr-real' ? ('success' as const) : ('failure' as const),
    )

    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion,
      findBotAuthoredPrs: async () => [],
    })

    expect(findRunConclusion).toHaveBeenCalledWith(TARGET_A, 'corr-real')
    expect(result.counts.itemsCompleted).toBe(1)
    expect(result.counts.goalsClosed).toBe(1)
  })

  it('run-success with no PR resolves to completed', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
      findBotAuthoredPrs: async () => [],
    })
    expect(result.counts.itemsCompleted).toBe(1)
  })

  it('run-success with a bot-merged PR resolves to completed', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
      findBotAuthoredPrs: async (): Promise<PrLookupResult[]> => [{merged: true, closed: true, authorIsBot: true}],
    })
    expect(result.counts.itemsCompleted).toBe(1)
  })

  it('a forged non-bot PR is ignored — no false completion signal from it alone', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
      findBotAuthoredPrs: async (): Promise<PrLookupResult[]> => [{merged: true, closed: true, authorIsBot: false}],
    })
    // Forged PR is filtered out entirely -> no bot PRs -> no-op success -> completed,
    // but crucially NOT because the forged PR's merged=true was trusted.
    expect(result.counts.itemsCompleted).toBe(1)
  })

  it('run-success with closed-unmerged PR resolves to failed', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'success',
      findBotAuthoredPrs: async (): Promise<PrLookupResult[]> => [{merged: false, closed: true, authorIsBot: true}],
    })
    expect(result.counts.itemsFailed).toBe(1)
  })

  it('run-failure resolves to failed', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_A,
      promptHash: 'h',
      status: 'dispatched',
      correlationId: 'c1',
    }
    const goalIssue = makeOpenGoal({goal: 'g', items: [item], markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A)],
      findRunConclusion: async () => 'failure',
      findBotAuthoredPrs: async () => [],
    })
    expect(result.counts.itemsFailed).toBe(1)
  })

  it('partial completion keeps the issue open (not all terminal)', async () => {
    const items: DispatchItem[] = [
      {id: 'item-1', target: TARGET_A, promptHash: 'h1', status: 'dispatched', correlationId: 'c1'},
      {
        id: 'item-2',
        target: {owner: 'fro-bot', name: 'wiki'},
        promptHash: 'h2',
        status: 'dispatched',
        correlationId: 'c2',
      },
    ]
    const goalIssue = makeOpenGoal({goal: 'g', items, markerHash: ''})
    const {octokit} = mockOctokitForGoal(goalIssue)
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A), gateEntryFor({owner: 'fro-bot', name: 'wiki'})],
      findRunConclusion: async (_target, correlationId) => (correlationId === 'c1' ? 'success' : undefined),
      findBotAuthoredPrs: async () => [],
    })
    expect(result.counts.itemsCompleted).toBe(1)
    expect(result.counts.goalsClosed).toBe(0)
    expect(result.counts.itemsStillOpen).toBe(1)
  })

  it('all-terminal closes the issue and posts a counts-only summary', async () => {
    const items: DispatchItem[] = [
      {id: 'item-1', target: TARGET_A, promptHash: 'h1', status: 'dispatched', correlationId: 'c1'},
      {
        id: 'item-2',
        target: {owner: 'fro-bot', name: 'wiki'},
        promptHash: 'h2',
        status: 'dispatched',
        correlationId: 'c2',
      },
    ]
    const goalIssue = makeOpenGoal({goal: 'g', items, markerHash: ''})
    const createComment = vi.fn(async (_params: {body: string}) => ({data: {id: 1}}))
    const updateComment = vi.fn(async (_params: {comment_id: number; body: string}) => ({}))
    const update = vi.fn(async (_params: unknown) => ({data: {}}))
    const {octokit} = mockOctokitForGoal(goalIssue, {createComment, updateComment, update})
    const result = await runTrack({
      octokit,
      repo: REPO,
      loadOpenGoalIssues: async () => [goalIssue],
      loadRegistry: async () => [gateEntryFor(TARGET_A), gateEntryFor({owner: 'fro-bot', name: 'wiki'})],
      findRunConclusion: async () => 'success',
      findBotAuthoredPrs: async () => [],
    })
    expect(result.counts.goalsClosed).toBe(1)
    // The marker comment already exists (seeded) so its update is in-place;
    // only the closing summary uses createComment (a distinct human-facing artifact).
    expect(updateComment).toHaveBeenCalledOnce()
    expect(createComment).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({state: 'closed'}))
    const summaryBody = createComment.mock.calls[0]?.[0]?.body as string
    expect(summaryBody).not.toContain('fro-bot/agent')
    expect(summaryBody).not.toContain('fro-bot/wiki')
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
      findBotAuthoredPrs: async () => [],
    })
    expect(result.counts.idempotentNoop).toBe(1)
    expect(createComment).not.toHaveBeenCalled()
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

describe('findBotAuthoredPrs — anti-spoof', () => {
  it('includes a bot-authored PR carrying the correlation id', async () => {
    const issuesAndPullRequests = vi.fn(async () => ({
      data: {
        items: [{number: 1, state: 'closed', user: {login: 'fro-bot'}, pull_request: {merged_at: '2026-01-01'}}],
      },
    }))
    const {octokit} = mockOctokit({issuesAndPullRequests})
    const result = await findBotAuthoredPrs(octokit)(TARGET_A, 'corr-1')
    expect(issuesAndPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({q: expect.stringContaining('corr-1') as string}),
    )
    expect(result).toEqual([{merged: true, closed: true, authorIsBot: true}])
  })

  it('excludes a forged PR authored by a non-bot login carrying the same correlation id', async () => {
    const issuesAndPullRequests = vi.fn(async () => ({
      data: {
        items: [
          {number: 1, state: 'closed', user: {login: 'fro-bot'}, pull_request: {merged_at: '2026-01-01'}},
          {number: 2, state: 'closed', user: {login: 'some-random-user'}, pull_request: {merged_at: '2026-01-01'}},
        ],
      },
    }))
    const {octokit} = mockOctokit({issuesAndPullRequests})
    const result = await findBotAuthoredPrs(octokit)(TARGET_A, 'corr-1')
    expect(result).toHaveLength(1)
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

  it('track: listWorkflowRunsForRepo for a marcusrbrown target goes through the marcusrbrown client', async () => {
    const item: DispatchItem = {
      id: 'item-1',
      target: TARGET_MARCUSRBROWN,
      promptHash: 'abcd1234abcd1234',
      status: 'dispatched',
      correlationId: 'corr-track-owner-1',
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
        nonce: 'nonce-1',
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
      const correlationIds = new Map(
        (finalMarker?.state.items ?? []).map(item => [item.target.name, item.correlationId as string]),
      )

      const listWorkflowRunsForRepo = vi.fn(async (params: {repo: string}) => ({
        data: {
          workflow_runs: [
            {
              id: 1,
              name: null,
              display_title: `fro-bot (${correlationIds.get(params.repo)})`,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        },
      }))
      const issuesAndPullRequests = vi.fn(async (params: {q: string}) => {
        const target = GOLDEN_TARGETS.find(t => params.q.includes(`repo:${t.owner}/${t.name}`))
        if (target === undefined) return {data: {items: []}}
        return {
          data: {
            items: [
              {
                number: 1,
                state: 'closed',
                user: {login: 'fro-bot'},
                pull_request: {merged_at: '2026-07-01T00:00:00Z'},
              },
            ],
          },
        }
      })
      const update = vi.fn(async (_params: unknown) => ({data: {}}))

      const trackListForRepo = vi.fn(async () => ({data: [{number: 42}]}))
      const trackOctokit = {
        ...octokit,
        rest: {
          ...octokit.rest,
          issues: {...octokit.rest.issues, listForRepo: trackListForRepo, update},
          actions: {...octokit.rest.actions, listWorkflowRunsForRepo},
          search: {...octokit.rest.search, issuesAndPullRequests},
        },
      }

      await runTrackCli(async () => trackOctokit, singleOwnerResolver(trackOctokit))

      expect(update).toHaveBeenCalledWith(expect.objectContaining({issue_number: 42, state: 'closed'}))

      const closedMarker = selectStateMarker(comments.map(c => ({author: {login: c.login}, body: c.body})))
      expect(closedMarker?.state.items.every(item => item.status === 'completed')).toBe(true)
    } finally {
      process.env = originalEnv
    }
  })
})
