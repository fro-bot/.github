/**
 * Contract tests for the wiki Edit link. The link target is owned by fro-bot/dashboard
 * (`docs/runbooks/wiki-editor.md`, "The `/wiki/<id>` contract"): the page ID is `<dir>.<name>`
 * for `knowledge/wiki/<dir>/<name>.md`, and the ID rule mirrors the dashboard's
 * `src/wiki/paths.ts` and `web/src/wiki/location.ts`. The Quartz component itself is harness-less
 * (a committed-dist local plugin), so this pins the pure helper and the config wiring.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {WIKI_EDITOR_URL_BASE, wikiEditUrl, wikiPageId} from '../quartz-site/local-plugin/dist/wiki-edit-link.js'

const quartzSiteDir = resolve(import.meta.dirname, '../quartz-site')

describe('wikiPageId', () => {
  it.each([
    ['knowledge/wiki/repos/marcusrbrown--infra.md', 'repos.marcusrbrown--infra'],
    ['knowledge/wiki/topics/ci-patterns.md', 'topics.ci-patterns'],
    ['knowledge/wiki/entities/esphome.md', 'entities.esphome'],
    ['knowledge/wiki/comparisons/bun-vs-pnpm.md', 'comparisons.bun-vs-pnpm'],
  ])('derives the ID for %s', (path, id) => {
    expect(wikiPageId(path)).toBe(id)
  })

  it('accepts dots and underscores inside the name', () => {
    expect(wikiPageId('knowledge/wiki/repos/owner--repo.js.md')).toBe('repos.owner--repo.js')
    expect(wikiPageId('knowledge/wiki/topics/a_b.md')).toBe('topics.a_b')
  })

  it.each([
    'knowledge/wiki/repos/nested/deeper.md',
    'knowledge/wiki/repos/a/b/c.md',
    'knowledge/wiki/other/thing.md',
    'knowledge/wiki/thing.md',
    'knowledge/wiki/README.md',
    'knowledge/index.md',
    'knowledge/log.md',
    'knowledge/schema.md',
    'knowledge/corrections.yaml',
    'knowledge/wiki/repos/thing.txt',
    'knowledge/wiki/repos/.md',
    'knowledge/wiki/repos/',
    'knowledge/wiki/repos',
    'wiki/repos/thing.md',
    '/knowledge/wiki/repos/thing.md',
    'docs/knowledge/wiki/repos/thing.md',
    '',
    '/',
    'index.md',
  ])('returns null for the non-page path %j', path => {
    expect(wikiPageId(path)).toBeNull()
  })

  it.each([
    ['a leading dash', 'knowledge/wiki/repos/-bad.md'],
    ['a trailing dash', 'knowledge/wiki/repos/bad-.md'],
    ['a leading dot', 'knowledge/wiki/repos/.bad.md'],
    ['a trailing dot', 'knowledge/wiki/repos/bad..md'],
    ['a leading underscore', 'knowledge/wiki/repos/_bad.md'],
    ['a dot segment', 'knowledge/wiki/repos/a..b.md'],
    ['a space', 'knowledge/wiki/repos/a b.md'],
    ['a percent escape', 'knowledge/wiki/repos/a%2Fb.md'],
    ['a query character', 'knowledge/wiki/repos/a?b.md'],
    ['a fragment character', 'knowledge/wiki/repos/a#b.md'],
    ['a backslash', String.raw`knowledge/wiki/repos/a\b.md`],
    ['a non-ASCII letter', 'knowledge/wiki/repos/caf\u00E9.md'],
  ])('returns null when the name has %s', (_label, path) => {
    expect(wikiPageId(path)).toBeNull()
  })

  it('enforces the 200-character limit on the whole ID', () => {
    // `repos.` is 6 characters, so a 194-character name is exactly 200.
    expect(wikiPageId(`knowledge/wiki/repos/${'a'.repeat(194)}.md`)).toBe(`repos.${'a'.repeat(194)}`)
    expect(wikiPageId(`knowledge/wiki/repos/${'a'.repeat(195)}.md`)).toBeNull()
    expect(wikiPageId(`knowledge/wiki/comparisons/${'a'.repeat(200)}.md`)).toBeNull()
  })
})

describe('wikiEditUrl', () => {
  it('joins the dashboard base and the ID with no query string', () => {
    expect(wikiEditUrl('knowledge/wiki/repos/marcusrbrown--infra.md')).toBe(
      'https://dashboard.fro.bot/wiki/repos.marcusrbrown--infra',
    )
  })

  it.each([
    ['knowledge/index.md'],
    ['knowledge/log.md'],
    ['knowledge/wiki/repos/nested/deeper.md'],
    ['knowledge/wiki/repos/-bad.md'],
    [`knowledge/wiki/repos/${'a'.repeat(195)}.md`],
  ])('returns null for %j', path => {
    expect(wikiEditUrl(path)).toBeNull()
  })

  it('never carries a return parameter, query, or fragment', () => {
    const url = wikiEditUrl('knowledge/wiki/topics/ci-patterns.md')
    expect(url).not.toBeNull()
    expect(url).not.toMatch(/[?#]/u)
  })
})

describe('quartz.config.yaml wiring', () => {
  interface PluginEntry {
    source: string | {repo: string; name?: string}
    enabled: boolean
    layout?: {position?: string; priority?: number}
  }

  const config = parse(readFileSync(resolve(quartzSiteDir, 'quartz.config.yaml'), 'utf8')) as {plugins: PluginEntry[]}
  const entry = config.plugins.find(
    plugin => typeof plugin.source === 'object' && plugin.source.name === 'WikiEditLink',
  )

  it('registers WikiEditLink from the local plugin, enabled, after the body', () => {
    expect(entry).toBeDefined()
    expect(entry?.enabled).toBe(true)
    expect(entry?.source).toEqual({repo: './local-plugin', name: 'WikiEditLink'})
    expect(entry?.layout?.position).toBe('afterBody')
  })

  it('declares WikiEditLink in the local plugin manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(quartzSiteDir, 'local-plugin/package.json'), 'utf8')) as {
      quartz: {components: Record<string, {defaultPosition: string}>}
    }
    expect(manifest.quartz.components.WikiEditLink?.defaultPosition).toBe('afterBody')
  })

  it('pins the dashboard URL base exactly', () => {
    expect(WIKI_EDITOR_URL_BASE).toBe('https://dashboard.fro.bot/wiki/')
  })

  it('exports the component from the plugin entry point', () => {
    const components = readFileSync(resolve(quartzSiteDir, 'local-plugin/dist/components/index.js'), 'utf8')
    expect(components).toMatch(/export\s*\{[^}]*\bWikiEditLink\b[^}]*\}/u)
  })

  it('renders only for real source files, not for generated folder or tag pages', () => {
    // Quartz fabricates `relativePath` for virtual pages (`wiki/repos/index.md`), which would map
    // to the unresolvable ID `repos.index`; only real files carry `filePath`. Verified in a local build.
    const components = readFileSync(resolve(quartzSiteDir, 'local-plugin/dist/components/index.js'), 'utf8')
    const body = components.slice(components.indexOf('const WikiEditLink'))
    expect(body).toMatch(/!filePath/u)
  })
})
