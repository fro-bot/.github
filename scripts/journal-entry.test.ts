import type {OctokitClient} from './journal-entry.ts'

import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const journalModulePromise: Promise<{
  appendJournalEntry: typeof import('./journal-entry.js').appendJournalEntry
  JournalEntryParams: never
}> = import(`./journal-entry${'.js'}`)
const {appendJournalEntry} = await journalModulePromise

interface MockOverrides {
  searchIssues?: (params: unknown) => Promise<unknown>
  removeLabel?: (params: unknown) => Promise<unknown>
  createIssue?: (params: unknown) => Promise<unknown>
  createComment?: (params: unknown) => Promise<unknown>
}

function createOctokitMock(overrides?: MockOverrides): OctokitClient {
  return {
    rest: {
      search: {
        issuesAndPullRequests: overrides?.searchIssues ?? (async () => ({data: {items: []}})),
      },
      issues: {
        removeLabel: overrides?.removeLabel ?? (async () => ({})),
        create:
          overrides?.createIssue ?? (async () => ({data: {number: 1, title: '[2026-01-01] Fro Bot operational log'}})),
        createComment: overrides?.createComment ?? (async () => ({data: {id: 99}})),
      },
    },
  } as unknown as OctokitClient
}

const FIXED_DATE = new Date('2026-01-15T10:00:00Z')

describe('appendJournalEntry', () => {
  it('creates a new journal issue when none exists for today', async () => {
    const createIssueCalls: unknown[] = []
    const createCommentCalls: unknown[] = []

    const octokit = createOctokitMock({
      createIssue: async params => {
        createIssueCalls.push(params)
        return {data: {number: 42, title: '[2026-01-15] Fro Bot operational log'}}
      },
      createComment: async params => {
        createCommentCalls.push(params)
        return {data: {id: 101}}
      },
    })

    const result = await appendJournalEntry({
      eventType: 'invitation_accepted',
      text: 'Accepted an invitation — welcome to the club.',
      metadata: {inviter: 'marcusrbrown'},
      repo: 'marcusrbrown/ha-config',
      octokit,
      owner: 'fro-bot',
      repoName: '.github',
      now: FIXED_DATE,
    })

    expect(result.issueNumber).toBe(42)
    expect(result.commentId).toBe(101)
    expect(result.created).toBe(true)
    expect(createIssueCalls).toHaveLength(1)
    const issue = createIssueCalls[0] as Record<string, unknown>
    expect(issue.title).toBe('[2026-01-15] Fro Bot operational log')
    expect(issue.labels).toContain('journal')
    expect(issue.labels).toContain('journal-active')
  })

  it('reuses an existing journal issue for today', async () => {
    const createIssueCalls: unknown[] = []
    const createCommentCalls: unknown[] = []

    const octokit = createOctokitMock({
      searchIssues: async () => ({
        data: {
          items: [{number: 7, title: '[2026-01-15] Fro Bot operational log'}],
        },
      }),
      createIssue: async params => {
        createIssueCalls.push(params)
        return {data: {number: 7, title: ''}}
      },
      createComment: async params => {
        createCommentCalls.push(params)
        return {data: {id: 200}}
      },
    })

    const result = await appendJournalEntry({
      eventType: 'repo_survey_complete',
      text: 'Surveyed another repo.',
      metadata: {},
      octokit,
      owner: 'fro-bot',
      repoName: '.github',
      now: FIXED_DATE,
    })

    expect(result.issueNumber).toBe(7)
    expect(result.created).toBe(false)
    expect(createIssueCalls).toHaveLength(0)
    expect(createCommentCalls).toHaveLength(1)
  })

  it('retires stale active issues from previous days', async () => {
    const removeLabelCalls: unknown[] = []

    const octokit = createOctokitMock({
      searchIssues: async () => ({
        data: {
          items: [
            // Today's issue
            {number: 10, title: '[2026-01-15] Fro Bot operational log'},
            // Yesterday's stale active issue
            {number: 5, title: '[2026-01-14] Fro Bot operational log'},
          ],
        },
      }),
      removeLabel: async params => {
        removeLabelCalls.push(params)
        return {}
      },
      createComment: async () => ({data: {id: 300}}),
    })

    const result = await appendJournalEntry({
      eventType: 'test',
      text: 'Test entry.',
      metadata: {},
      octokit,
      owner: 'fro-bot',
      repoName: '.github',
      now: FIXED_DATE,
    })

    expect(result.issueNumber).toBe(10)
    expect(removeLabelCalls).toHaveLength(1)
    const removeCall = removeLabelCalls[0] as Record<string, unknown>
    expect(removeCall.issue_number).toBe(5)
    expect(removeCall.name).toBe('journal-active')
  })

  it('embeds structured metadata in the comment body', async () => {
    const createCommentCalls: unknown[] = []

    const octokit = createOctokitMock({
      createComment: async params => {
        createCommentCalls.push(params)
        return {data: {id: 400}}
      },
    })

    await appendJournalEntry({
      eventType: 'invitation_accepted',
      text: 'Welcomed into a new repo.',
      metadata: {inviter: 'marcusrbrown', count: 3},
      repo: 'marcusrbrown/project',
      runUrl: 'https://github.com/fro-bot/.github/actions/runs/123',
      octokit,
      owner: 'fro-bot',
      repoName: '.github',
      now: FIXED_DATE,
    })

    const comment = createCommentCalls[0] as Record<string, unknown>
    const body = comment.body as string
    expect(body).toContain('Welcomed into a new repo.')
    expect(body).toContain('<details>')
    expect(body).toContain('"event": "invitation_accepted"')
    expect(body).toContain('"repo": "marcusrbrown/project"')
    expect(body).toContain('"run_url": "https://github.com/fro-bot/.github/actions/runs/123"')
    expect(body).toContain('"inviter": "marcusrbrown"')
  })

  it('creates today issue when only stale active issues exist', async () => {
    const createIssueCalls: unknown[] = []

    const octokit = createOctokitMock({
      searchIssues: async () => ({
        data: {
          items: [{number: 3, title: '[2026-01-14] Fro Bot operational log'}],
        },
      }),
      createIssue: async params => {
        createIssueCalls.push(params)
        return {data: {number: 11}}
      },
      createComment: async () => ({data: {id: 500}}),
    })

    const result = await appendJournalEntry({
      eventType: 'test',
      text: 'New day, new log.',
      metadata: {},
      octokit,
      owner: 'fro-bot',
      repoName: '.github',
      now: FIXED_DATE,
    })

    expect(result.created).toBe(true)
    expect(createIssueCalls).toHaveLength(1)
  })
})
