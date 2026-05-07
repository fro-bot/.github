import {appendFile, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import {parse} from 'yaml'

const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu
const PAGE_PATH_PATTERN = /^knowledge\/wiki\/[^/]+\/.+\.md$/u
const REQUIRED_FRONTMATTER_FIELDS = ['type', 'title', 'created', 'updated'] as const
const STALE_DAYS = 90

export type WikiLintFindingKind =
  | 'broken-wikilink'
  | 'orphan-page'
  | 'index-drift'
  | 'missing-frontmatter'
  | 'invalid-frontmatter'
  | 'stale-claim'
  | 'missing-cross-reference'
  | 'knowledge-gap'

export interface WikiLintFinding {
  readonly kind: WikiLintFindingKind
  readonly path: string
  readonly message: string
  readonly target?: string
}

export interface WikiLintResult {
  readonly ok: boolean
  readonly deterministicFindings: readonly WikiLintFinding[]
  readonly advisoryFindings: readonly WikiLintFinding[]
  readonly summary: string
  readonly report: string
}

export interface LintWikiSnapshotParams {
  readonly files: Record<string, string>
  readonly now?: Date
}

export interface WriteWikiLintOutputsParams {
  readonly result: WikiLintResult
  readonly reportPath: string
  readonly githubStepSummaryPath?: string
  readonly githubOutputPath?: string
}

export interface WriteWikiLintOutputsResult {
  readonly status: 'clean' | 'findings'
  readonly reportPath: string
}

export interface WriteWikiLintFailureOutputsParams {
  readonly message: string
  readonly reportPath: string
  readonly githubStepSummaryPath?: string
  readonly githubOutputPath?: string
}

export interface WriteWikiLintFailureOutputsResult {
  readonly status: 'execution-failure'
  readonly reportPath: string
}

export interface RunWikiLintParams {
  readonly rootDir?: string
  readonly reportPath: string
  readonly githubStepSummaryPath?: string
  readonly githubOutputPath?: string
  readonly now?: Date
}

export interface RunWikiLintResult extends WriteWikiLintOutputsResult {
  readonly result: WikiLintResult
}

interface ParsedPage {
  readonly path: string
  readonly slug: string
  readonly content: string
  readonly body: string
  readonly frontmatter: Record<string, unknown>
  readonly frontmatterError?: string
}

export function lintWikiSnapshot(params: LintWikiSnapshotParams): WikiLintResult {
  const now = params.now ?? new Date()
  const pages = collectPages(params.files)
  const pageTargets = collectPageTargets(pages)
  const indexedSlugs = collectIndexedSlugs(params.files['knowledge/index.md'] ?? '')
  const hasNonRepoKnowledge = pages.some(
    page =>
      page.frontmatter.type === 'topic' || page.frontmatter.type === 'entity' || page.frontmatter.type === 'comparison',
  )

  const deterministicFindings: WikiLintFinding[] = []
  const advisoryFindings: WikiLintFinding[] = []

  for (const page of pages) {
    const missingFields = REQUIRED_FRONTMATTER_FIELDS.filter(field => !hasNonEmptyString(page.frontmatter[field]))
    if (page.frontmatterError !== undefined) {
      deterministicFindings.push({
        kind: 'invalid-frontmatter',
        path: page.path,
        message: page.frontmatterError,
      })
      continue
    }

    if (missingFields.length > 0) {
      deterministicFindings.push({
        kind: 'missing-frontmatter',
        path: page.path,
        message: `Missing required frontmatter: ${missingFields.join(', ')}`,
      })
    }

    for (const target of collectWikilinks(page.body)) {
      if (!pageTargets.has(target)) {
        deterministicFindings.push({
          kind: 'broken-wikilink',
          path: page.path,
          target,
          message: `Broken wikilink to [[${target}]]`,
        })
      }
    }

    if (!indexedSlugs.has(page.slug)) {
      deterministicFindings.push({
        kind: 'orphan-page',
        path: page.path,
        message: `Page ${page.slug} exists on disk but is missing from knowledge/index.md`,
      })
    }

    if (isStale(page.frontmatter.updated, now)) {
      advisoryFindings.push({
        kind: 'stale-claim',
        path: page.path,
        message: `Page has not been updated in ${STALE_DAYS}+ days`,
      })
    }

    if (!page.body.includes('[[')) {
      advisoryFindings.push({
        kind: 'missing-cross-reference',
        path: page.path,
        message: 'Page has no wikilinks to related knowledge',
      })

      if (page.frontmatter.type === 'repo' && hasNonRepoKnowledge) {
        advisoryFindings.push({
          kind: 'knowledge-gap',
          path: 'knowledge/index.md',
          message: `Repo page ${page.slug} is not connected to existing non-repo knowledge`,
        })
      }
    }
  }

  for (const indexedSlug of indexedSlugs) {
    if (pageTargets.has(indexedSlug)) {
      continue
    }

    deterministicFindings.push({
      kind: 'index-drift',
      path: 'knowledge/index.md',
      target: indexedSlug,
      message: `Index references [[${indexedSlug}]] but no page exists on disk`,
    })
  }

  const summary = [
    '# Wiki lint summary',
    '',
    `Deterministic findings: ${deterministicFindings.length}`,
    `Advisory findings: ${advisoryFindings.length}`,
  ].join('\n')

  const reportSections = [
    '# Wiki Lint Report',
    '',
    renderSection('Deterministic findings', deterministicFindings),
    '',
    '## Advisory findings',
    '',
    '_These are non-blocking advisory signals._',
    '',
    ...renderFindingLines(advisoryFindings),
  ]

  const report = reportSections.join('\n')

  return {
    ok: deterministicFindings.length === 0,
    deterministicFindings,
    advisoryFindings,
    summary,
    report,
  }
}

export async function writeWikiLintOutputs(params: WriteWikiLintOutputsParams): Promise<WriteWikiLintOutputsResult> {
  const status =
    params.result.deterministicFindings.length === 0 && params.result.advisoryFindings.length === 0
      ? 'clean'
      : 'findings'

  await writeFile(params.reportPath, `${params.result.report}\n`, 'utf8')

  if (params.githubStepSummaryPath !== undefined && params.githubStepSummaryPath !== '') {
    await appendFile(params.githubStepSummaryPath, `${params.result.summary}\n`, 'utf8')
  }

  if (params.githubOutputPath !== undefined && params.githubOutputPath !== '') {
    const lines = [`status=${status}`, `report_path=${params.reportPath}`]
    await appendFile(params.githubOutputPath, `${lines.join('\n')}\n`, 'utf8')
  }

  return {status, reportPath: params.reportPath}
}

export async function writeWikiLintFailureOutputs(
  params: WriteWikiLintFailureOutputsParams,
): Promise<WriteWikiLintFailureOutputsResult> {
  const summary = ['# Wiki lint summary', '', 'Execution failure', '', params.message].join('\n')
  const report = ['# Wiki Lint Report', '', '## Execution failure', '', params.message].join('\n')

  await writeFile(params.reportPath, `${report}\n`, 'utf8')

  if (params.githubStepSummaryPath !== undefined && params.githubStepSummaryPath !== '') {
    await appendFile(params.githubStepSummaryPath, `${summary}\n`, 'utf8')
  }

  if (params.githubOutputPath !== undefined && params.githubOutputPath !== '') {
    const lines = ['status=execution-failure', `report_path=${params.reportPath}`]
    await appendFile(params.githubOutputPath, `${lines.join('\n')}\n`, 'utf8')
  }

  return {status: 'execution-failure', reportPath: params.reportPath}
}

export async function runWikiLint(params: RunWikiLintParams): Promise<RunWikiLintResult> {
  const rootDir = params.rootDir ?? process.cwd()
  const files = await loadWikiFilesFromDisk(rootDir)
  const result = lintWikiSnapshot({files, now: params.now})
  const outputs = await writeWikiLintOutputs({
    result,
    reportPath: params.reportPath,
    githubStepSummaryPath: params.githubStepSummaryPath,
    githubOutputPath: params.githubOutputPath,
  })

  return {...outputs, result}
}

function renderSection(title: string, findings: readonly WikiLintFinding[]): string {
  return [`## ${title}`, '', ...renderFindingLines(findings)].join('\n')
}

function renderFindingLines(findings: readonly WikiLintFinding[]): string[] {
  if (findings.length === 0) {
    return ['No findings.']
  }

  return findings.map(
    finding =>
      `- \`${finding.kind}\` | ${finding.path}${finding.target === undefined ? '' : ` | target=${finding.target}`} | ${finding.message}`,
  )
}

async function loadWikiFilesFromDisk(rootDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const indexPath = join(rootDir, 'knowledge', 'index.md')
  files['knowledge/index.md'] = await readFile(indexPath, 'utf8')

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = join(rootDir, 'knowledge', 'wiki', directory)
    let entries

    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch (error: unknown) {
      if (isErrorWithCode(error, 'ENOENT')) {
        continue
      }
      throw error
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const relativePath = `knowledge/wiki/${directory}/${entry.name}`
      files[relativePath] = await readFile(join(directoryPath, entry.name), 'utf8')
    }
  }

  return files
}

function collectPages(files: Record<string, string>): ParsedPage[] {
  return Object.entries(files)
    .filter(([path]) => PAGE_PATH_PATTERN.test(path))
    .map(([path, content]) => {
      const {frontmatter, body, error} = splitFrontmatter(content)
      const pathParts = path.split('/')
      // eslint-disable-next-line unicorn/prefer-at -- false-positive here; tsconfig/lsp intermittently flags .at()
      const fileName = pathParts[pathParts.length - 1]
      return {
        path,
        slug: (fileName ?? path).replace(/\.md$/u, ''),
        content,
        body,
        frontmatter,
        frontmatterError: error,
      }
    })
}

function collectIndexedSlugs(indexContent: string): Set<string> {
  return new Set(collectWikilinks(indexContent))
}

function collectPageTargets(pages: readonly ParsedPage[]): Set<string> {
  const targets = new Set<string>()

  for (const page of pages) {
    targets.add(page.slug)

    const aliases = page.frontmatter.aliases
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.trim() !== '') {
          targets.add(alias)
        }
      }
    }
  }

  return targets
}

function collectWikilinks(content: string): string[] {
  const matches = content.matchAll(WIKILINK_PATTERN)
  return Array.from(matches, match => match[1]).filter((value): value is string => value !== undefined && value !== '')
}

function splitFrontmatter(content: string): {frontmatter: Record<string, unknown>; body: string; error?: string} {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null) {
    return {frontmatter: {}, body: content.trim()}
  }

  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    return {frontmatter: {}, body: content.trim()}
  }

  let parsed: unknown
  try {
    parsed = parse(frontmatterText)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown YAML parse error'
    return {
      frontmatter: {},
      body: content.slice(match[0].length).trim(),
      error: `Invalid YAML frontmatter: ${message}`,
    }
  }

  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: content.slice(match[0].length).trim(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && typeof error.code === 'string' && error.code === code
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isStale(updated: unknown, now: Date): boolean {
  if (!hasNonEmptyString(updated)) {
    return false
  }

  const updatedDate = new Date(`${String(updated)}T00:00:00Z`)
  if (Number.isNaN(updatedDate.getTime())) {
    return false
  }

  const ageMs = now.getTime() - updatedDate.getTime()
  return ageMs >= STALE_DAYS * 24 * 60 * 60 * 1000
}

async function main(): Promise<void> {
  const reportPath = process.env.WIKI_LINT_REPORT_PATH ?? 'wiki-lint-report.md'
  const failureMessage = process.env.WIKI_LINT_FAILURE_MESSAGE

  if (failureMessage !== undefined && failureMessage !== '') {
    await writeWikiLintFailureOutputs({
      message: failureMessage,
      reportPath,
      githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
      githubOutputPath: process.env.GITHUB_OUTPUT,
    })
    process.stderr.write(`wiki-lint: ${failureMessage}\n`)
    process.exit(1)
  }

  try {
    const result = await runWikiLint({
      reportPath,
      githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
      githubOutputPath: process.env.GITHUB_OUTPUT,
    })

    process.stdout.write(`${JSON.stringify(result.result)}\n`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown wiki lint execution failure'
    await writeWikiLintFailureOutputs({
      message,
      reportPath,
      githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
      githubOutputPath: process.env.GITHUB_OUTPUT,
    })
    process.stderr.write(`wiki-lint: ${message}\n`)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
