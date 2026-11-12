import {readdirSync, readFileSync} from 'node:fs'
import {join, relative, sep} from 'node:path'
import process from 'node:process'
import {collectSolutionDocs} from '@fro-bot/knowledge/capture-learnings-harvest'
import {collectSolutionDocSources} from '@fro-bot/knowledge/capture-patterns-synthesis'
import {splitFrontmatter} from '@fro-bot/reports/improvement-metrics-detect'
import {
  buildPlanConsistencyClaim,
  correctPlanConsistencyStatusLine,
  SUPPORTED_PLAN_STATUSES,
} from '@fro-bot/status-truth/detect-plan-consistency'
import {assembleSolutionsContext} from '@fro-bot/wiki-ops/solutions-query'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const repositoryRoot = process.cwd()

function markdownFilesUnder(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), {withFileTypes: true, recursive: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => relative(repositoryRoot, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * The frontmatter reading the solution-doc sites used before the splitter: the first line that starts with `---`
 * closed the block, an LF-only fence, and invalid YAML threw.
 */
function oldFrontmatterRecord(content: string): Record<string, unknown> | 'invalid-yaml' {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match?.[1] === undefined) return {}
  let parsed: unknown
  try {
    parsed = parse(match[1])
  } catch {
    return 'invalid-yaml'
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

function oldPlanStatus(content: string): string | null {
  const match = /^---\r?\n([\s\S]+?)\r?\n---/u.exec(content)
  if (match === null || match[1] === undefined) return null
  const status = /^status:\s*["']?(\w+)["']?\s*$/mu.exec(match[1])
  if (status === null || status[1] === undefined) return null
  return status[1].toLowerCase()
}

function oldCorrect(content: string): string | null {
  const frontmatterMatch = /^(---\r?\n)([\s\S]+?)(\r?\n---)/u.exec(content)
  if (frontmatterMatch === null) return null
  const [fullMatch, openDelim, frontmatterText, closeDelim] = frontmatterMatch
  if (openDelim === undefined || frontmatterText === undefined || closeDelim === undefined) return null
  const statusLinePattern = /^status:\s*["']?(\w+)["']?\s*$/mu
  if (statusLinePattern.exec(frontmatterText) === null) return null
  return `${content.slice(
    0,
    frontmatterMatch.index,
  )}${openDelim}${frontmatterText.replace(statusLinePattern, 'status: complete')}${closeDelim}${content.slice(
    frontmatterMatch.index + fullMatch.length,
  )}`
}

const stringField = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : ''
const tagsField = (record: Record<string, unknown>): string[] =>
  Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : []

describe('every Markdown file under docs/solutions reads the same as before at each site that reads it', () => {
  const paths = markdownFilesUnder('docs/solutions')

  it('finds the documents, so a scan that matches nothing cannot pass', () => {
    expect(paths.length).toBeGreaterThan(10)
  })

  it.each(paths)('%s', path => {
    const content = readFileSync(join(repositoryRoot, path), 'utf8')
    const old = oldFrontmatterRecord(content)
    const files = {[path]: content}

    // Improvement metrics: the mapping, or no metadata for any failure.
    expect(splitFrontmatter(content)).toEqual(old === 'invalid-yaml' ? {} : old)

    // Learnings harvest: a document with invalid YAML is skipped; the rest keep module, tags and problem_type.
    expect(collectSolutionDocs(files)).toEqual(
      old === 'invalid-yaml'
        ? []
        : [
            {
              path,
              module: stringField(old, 'module'),
              tags: tagsField(old),
              problemType: stringField(old, 'problem_type'),
            },
          ],
    )

    // Pattern synthesis: the stem fixes identity; an invalid document is counted and excluded.
    const synthesis = collectSolutionDocSources(files, 'f'.repeat(40))
    if (old === 'invalid-yaml') {
      expect(synthesis).toEqual({sources: [], invalidCount: 1})
    } else {
      const stem = path.slice(path.lastIndexOf('/') + 1, -'.md'.length)
      expect(synthesis.invalidCount).toBe(0)
      expect(synthesis.sources.map(source => source.title)).toEqual([stringField(old, 'title') || stem])
      expect(synthesis.sources.map(source => source.signals.module)).toEqual([stringField(old, 'module')])
      expect(synthesis.sources.map(source => source.signals.tags)).toEqual([tagsField(old)])
    }

    // Solutions search: no document in the corpus is skipped for its frontmatter.
    const warnings: string[] = []
    assembleSolutionsContext({
      files,
      event: {eventName: 'issues', title: 'frontmatter', body: ''},
      privateNames: [],
      now: new Date('2026-11-12'),
      warn: line => warnings.push(line),
    })
    expect(warnings.filter(line => line.includes('malformed frontmatter'))).toEqual(
      old === 'invalid-yaml' ? [expect.stringContaining(`(path: ${path})`)] : [],
    )
  })
})

describe('every plan under docs/plans reads the same as before at the plan-status sites', () => {
  const paths = markdownFilesUnder('docs/plans').filter(path => !path.slice('docs/plans/'.length).includes('/'))

  it('finds the plans, so a scan that matches nothing cannot pass', () => {
    expect(paths.length).toBeGreaterThan(10)
  })

  it.each(paths)('%s', path => {
    const content = readFileSync(join(repositoryRoot, path), 'utf8')
    const oldStatus = oldPlanStatus(content)
    const expectedClaim = oldStatus !== null && SUPPORTED_PLAN_STATUSES.includes(oldStatus) ? oldStatus : undefined

    const claim = buildPlanConsistencyClaim(path, content)
    if (expectedClaim === undefined) {
      expect(SUPPORTED_PLAN_STATUSES).not.toContain(claim.claimedState)
    } else {
      expect(claim.claimedState).toBe(expectedClaim)
    }
    expect(correctPlanConsistencyStatusLine(content)).toBe(oldCorrect(content))
  })
})

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), {withFileTypes: true, recursive: true})
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        relative(repositoryRoot, entry.parentPath).split(sep).includes('src'),
    )
    .map(entry => relative(repositoryRoot, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

describe('no production code outside the splitter finds a frontmatter block with a regular expression', () => {
  const sources = sourceFilesUnder('packages')

  it('scans the package sources, so a scan that matches nothing cannot pass', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources).toContain('packages/wiki-write-core/src/frontmatter-block.ts')
  })

  it('finds no regular expression literal that starts with ^--- outside frontmatter-block.ts', () => {
    const offenders = sources.filter(path => {
      if (path === 'packages/wiki-write-core/src/frontmatter-block.ts') return false
      return /\/\^\(*---/u.test(readFileSync(join(repositoryRoot, path), 'utf8'))
    })
    expect(offenders).toEqual([])
  })

  it('the scan sees a literal of that shape', () => {
    expect(/\/\^\(*---/u.test(String.raw`const match = /^---\n([\s\S]+?)\n---/u.exec(content)`)).toBe(true)
    expect(/\/\^\(*---/u.test(String.raw`const match = /^(---\r?\n)([\s\S]+?)(\r?\n---)/u.exec(content)`)).toBe(true)
    expect(/\/\^\(*---/u.test('const none = /^abc/u')).toBe(false)
  })
})
