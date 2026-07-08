import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiContextSafetyModulePromise: Promise<{
  evaluateCandidateSafety: typeof import('./wiki-context-safety.js').evaluateCandidateSafety
  filterSafeCandidates: typeof import('./wiki-context-safety.js').filterSafeCandidates
}> = import(`./wiki-context-safety${'.js'}`)
const {evaluateCandidateSafety, filterSafeCandidates} = await wikiContextSafetyModulePromise

const PRIVATE_TOKENS = new Set(['marcusrbrown/secret-repo', 'marcusrbrown--secret-repo'])

describe('evaluateCandidateSafety', () => {
  it('marks a candidate safe when no field contains a private token', () => {
    // #given a candidate whose path/title/body/aliases are all public
    const candidate = {
      path: 'knowledge/wiki/repos/fro-bot--agent.md',
      title: 'Fro Bot Agent',
      body: 'Fro Bot Agent uses Vitest and Octokit.',
      aliases: ['fba'],
    }

    // #when the candidate is evaluated
    const result = evaluateCandidateSafety(candidate, PRIVATE_TOKENS)

    // #then it is reported safe with no unsafe fields
    expect(result.safe).toBe(true)
    expect(result.unsafeFields).toEqual([])
  })

  it('excludes a candidate whose body contains a private token — mutation gate proof (body)', () => {
    // #given two otherwise-identical candidates, one with a private token planted in the body
    const safeCandidate = {
      path: 'knowledge/wiki/repos/fro-bot--agent.md',
      title: 'Fro Bot Agent',
      body: 'Ordinary public body text about a repo.',
    }
    const unsafeCandidate = {
      ...safeCandidate,
      body: 'This body references marcusrbrown/secret-repo directly.',
    }

    // #when both are evaluated against the same private token set
    const safeResult = evaluateCandidateSafety(safeCandidate, PRIVATE_TOKENS)
    const unsafeResult = evaluateCandidateSafety(unsafeCandidate, PRIVATE_TOKENS)

    // #then only the token-bearing candidate is excluded — the gate is what causes the
    // difference, not scoring or content length
    expect(safeResult.safe).toBe(true)
    expect(unsafeResult.safe).toBe(false)
    expect(unsafeResult.unsafeFields).toContain('body')
  })

  it('excludes a candidate whose path contains a private token, not only unsafe bodies', () => {
    // #given a candidate with a safe body but an unsafe path
    const candidate = {
      path: 'knowledge/wiki/repos/marcusrbrown--secret-repo.md',
      title: 'Some Title',
      body: 'Ordinary public body text.',
    }

    // #when the candidate is evaluated
    const result = evaluateCandidateSafety(candidate, PRIVATE_TOKENS)

    // #then the path-only leak is caught — safety is not body-only
    expect(result.safe).toBe(false)
    expect(result.unsafeFields).toContain('path')
  })

  it('excludes a candidate whose alias-derived target contains a private token', () => {
    // #given a candidate with a safe path/title/body but an unsafe alias
    const candidate = {
      path: 'knowledge/wiki/repos/fro-bot--agent.md',
      title: 'Fro Bot Agent',
      body: 'Ordinary public body text.',
      aliases: ['marcusrbrown/secret-repo'],
    }

    // #when the candidate is evaluated
    const result = evaluateCandidateSafety(candidate, PRIVATE_TOKENS)

    // #then the alias leak is caught
    expect(result.safe).toBe(false)
    expect(result.unsafeFields).toContain('aliases')
  })

  it('excludes a candidate whose title contains a private token', () => {
    // #given a candidate whose title itself leaks a private identifier
    const candidate = {
      path: 'knowledge/wiki/repos/fro-bot--agent.md',
      title: 'Notes on marcusrbrown/secret-repo',
      body: 'Ordinary public body text.',
    }

    // #when the candidate is evaluated
    const result = evaluateCandidateSafety(candidate, PRIVATE_TOKENS)

    // #then the title leak is caught
    expect(result.safe).toBe(false)
    expect(result.unsafeFields).toContain('title')
  })

  it('over-excludes substring matches by design because the gate is fail-closed', () => {
    // #given a page mentioning a public-looking suffix that still contains a private token
    const candidate = {
      path: 'knowledge/wiki/topics/api-docs.md',
      title: 'API docs',
      body: 'Public docs mention marcusrbrown/secret-repo-docs as an example string.',
    }

    // #when the safety gate scans with substring semantics
    const result = evaluateCandidateSafety(candidate, PRIVATE_TOKENS)

    // #then it excludes the candidate: false positives are acceptable, false negatives are not
    expect(result.safe).toBe(false)
    expect(result.unsafeFields).toContain('body')
  })
})

describe('filterSafeCandidates', () => {
  it('runs the safety gate before any excerpt payload is assembled — proof the gate is active', () => {
    // #given a list of candidates where one plants a private token
    const candidates = [
      {path: 'knowledge/wiki/repos/fro-bot--agent.md', title: 'Fro Bot Agent', body: 'Public body one.'},
      {
        path: 'knowledge/wiki/repos/other.md',
        title: 'Other',
        body: 'Leaks marcusrbrown/secret-repo in the body.',
      },
      {path: 'knowledge/wiki/topics/vitest.md', title: 'Vitest', body: 'Public body two.'},
    ]

    // #when filtered through the safety gate
    const safe = filterSafeCandidates(candidates, PRIVATE_TOKENS)

    // #then only the safe candidates remain — removing this call would let the leaking
    // candidate reach formatting, which is exactly what this test pins
    expect(safe.map(c => c.path)).toEqual(['knowledge/wiki/repos/fro-bot--agent.md', 'knowledge/wiki/topics/vitest.md'])
  })

  it('returns all candidates unfiltered when the private token set is empty', () => {
    // #given no private tokens loaded
    const candidates = [{path: 'knowledge/wiki/repos/fro-bot--agent.md', title: 'Fro Bot Agent', body: 'Body.'}]

    // #when filtered
    const safe = filterSafeCandidates(candidates, new Set())

    // #then nothing is excluded — an empty token set matches nothing
    expect(safe).toHaveLength(1)
  })
})
