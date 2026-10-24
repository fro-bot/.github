/**
 * Fixtures for the operator rename tests: redacted-shape copies of the live `marcusrbrown/panthe.ai`
 * repo page and of the topic page that references it (`related:` entry and body wikilink). The
 * prose is elided; the frontmatter keys, source-entry shape, table row and link forms are the
 * live ones. Test support only.
 */

export const NODE_ID = 'R_kgDOJt6i0Q'
export const OWNER = 'marcusrbrown'
export const OLD_NAME = 'panthe.ai'
export const NEW_NAME = 'panthea'
export const OLD_SLUG = 'marcusrbrown--panthe-ai'
export const NEW_SLUG = 'marcusrbrown--panthea'
export const OLD_URL = 'https://github.com/marcusrbrown/panthe.ai'
export const NEW_URL = 'https://github.com/marcusrbrown/panthea'

export const INDEX_PATH = 'knowledge/index.md'
export const LOG_PATH = 'knowledge/log.md'
export const README_PATH = 'knowledge/wiki/README.md'
export const OLD_PAGE_PATH = `knowledge/wiki/repos/${OLD_SLUG}.md`
export const NEW_PAGE_PATH = `knowledge/wiki/repos/${NEW_SLUG}.md`
export const TOPIC_PATH = 'knowledge/wiki/topics/github-actions-ci.md'
export const MOTHERSHIP_PATH = 'knowledge/wiki/repos/marcusrbrown--mothership.md'

export function oldRepoPage(
  overrides: {nodeId?: string | null; sourceUrls?: string[] | null; body?: string} = {},
): string {
  const nodeId = overrides.nodeId === undefined ? null : overrides.nodeId
  const sourceUrls = overrides.sourceUrls === undefined ? [OLD_URL, OLD_URL] : overrides.sourceUrls
  const lines = [
    '---',
    'type: repo',
    'title: marcusrbrown/panthe.ai',
    'created: 2026-09-26',
    'updated: 2026-09-26',
    ...(nodeId === null ? [] : [`node_id: ${nodeId}`]),
    ...(sourceUrls === null
      ? []
      : [
          'sources:',
          ...sourceUrls.flatMap((url, index) => [
            `  - url: ${url}`,
            `    sha: ${String(index).repeat(40)}`,
            '    accessed: 2026-09-26',
          ]),
        ]),
    'tags:',
    '  - repository-stub',
    '  - bun',
    'related:',
    '  - github-actions-ci',
    '  - marcusrbrown--mothership',
    '---',
    '',
    '# marcusrbrown/panthe.ai',
    '',
    overrides.body ?? 'Scaffold survey notes. See [[marcusrbrown--mothership]] for another Tauri app.',
    '',
    'The automation status is recorded in [[github-actions-ci]].',
    '',
  ]
  return lines.join('\n')
}

export function topicPage(
  related: string[] = [OLD_SLUG, 'marcusrbrown--mothership'],
  tableLink = `[[${OLD_SLUG}]]`,
): string {
  return [
    '---',
    'type: topic',
    'title: GitHub Actions CI',
    'created: 2026-06-01',
    'updated: 2026-10-07',
    'tags:',
    '  - ci',
    'related:',
    ...related.map(entry => `  - ${entry}`),
    '---',
    '',
    '# GitHub Actions CI',
    '',
    '| Repo | Status | Notes |',
    '| --- | --- | --- |',
    `| ${tableLink} | Present at the second survey | N/A |`,
    '| [[marcusrbrown--mothership]] | Present | N/A |',
    '',
  ].join('\n')
}

export function mothershipPage(): string {
  return [
    '---',
    'type: repo',
    'title: marcusrbrown/mothership',
    'created: 2026-07-06',
    'updated: 2026-10-07',
    'node_id: R_kgDOTOX0_A',
    'sources:',
    '  - url: https://github.com/marcusrbrown/mothership',
    `    sha: ${'a'.repeat(40)}`,
    '    accessed: 2026-10-07',
    'related:',
    '  - github-actions-ci',
    '---',
    '',
    '# marcusrbrown/mothership',
    '',
    'Tauri desktop shell.',
    '',
  ].join('\n')
}

export const LOG_HISTORY = [
  '# Wiki Log',
  '',
  'Chronological record of all wiki operations.',
  '',
  '---',
  '',
  '_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._',
  '',
  '## [2026-09-26 23:00] ingest | marcusrbrown/panthe.ai',
  '',
  `Survey of the repo. Linked [[${OLD_SLUG}]] from [[github-actions-ci]].`,
  '',
  `Sources: ${OLD_URL}`,
  '',
].join('\n')

export const INDEX_PAGE = [
  '# Wiki Index',
  '',
  'Master catalog of all wiki pages, organized by type.',
  '',
  '## Repos',
  '',
  `- [[${OLD_SLUG}]] — Placeholder scaffold with a curated description.`,
  '- [[marcusrbrown--mothership]] — marcusrbrown/mothership',
  '',
  '## Topics',
  '',
  '- [[github-actions-ci]] — GitHub Actions CI',
  '',
  '## Entities',
  '',
  '_No entity pages yet. Pages will appear here as tools and services are documented._',
  '',
  '## Comparisons',
  '',
  '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
  '',
  '---',
  '',
  '_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._',
  '',
].join('\n')

export const README_BODY = `# Wiki\n\nHuman scaffolding. Mentions [[${OLD_SLUG}]] on purpose; it is never rewritten.\n`

export function snapshot(overrides: Record<string, string | null> = {}): Record<string, string> {
  const files: Record<string, string> = {
    [INDEX_PATH]: INDEX_PAGE,
    [LOG_PATH]: LOG_HISTORY,
    [README_PATH]: README_BODY,
    [OLD_PAGE_PATH]: oldRepoPage(),
    [MOTHERSHIP_PATH]: mothershipPage(),
    [TOPIC_PATH]: topicPage(),
  }
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path]
    else files[path] = content
  }
  return files
}
