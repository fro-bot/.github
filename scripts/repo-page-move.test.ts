import type {RepoEntry} from './schemas.ts'
import {
  applyPageChanges,
  attributesPageTo,
  mergeWikiLogs,
  pageReflectsRename,
  pageSourceUrls,
  parseFrontmatterDocument,
  planRepoPageMove,
  validateWikilinks,
  type PageChange,
  type PlanRepoPageMoveParams,
  type RepoPageMovePlan,
} from '@fro-bot/wiki-write-core'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import {buildPublicSlugMap, detectPrivateWikiLeaks, type WikiPageSnapshot} from './check-wiki-private-presence.ts'
import {
  INDEX_PAGE,
  INDEX_PATH,
  LOG_HISTORY,
  LOG_PATH,
  MOTHERSHIP_PATH,
  mothershipPage,
  NEW_NAME,
  NEW_PAGE_PATH,
  NEW_SLUG,
  NEW_URL,
  NODE_ID,
  OLD_NAME,
  OLD_PAGE_PATH,
  OLD_SLUG,
  OLD_URL,
  oldRepoPage,
  OWNER,
  README_BODY,
  README_PATH,
  snapshot,
  TOPIC_PATH,
  topicPage,
} from './repo-page-move-fixtures.ts'
import {buildPrivateTokenSet, computeRepoSlug} from './wiki-slug.ts'

const TIMESTAMP = new Date('2026-10-10T12:34:56Z')

function moveParams(overrides: Partial<PlanRepoPageMoveParams> = {}): PlanRepoPageMoveParams {
  return {
    files: snapshot(),
    nodeId: NODE_ID,
    owner: OWNER,
    oldName: OLD_NAME,
    newName: NEW_NAME,
    rowName: OLD_NAME,
    otherRows: [{owner: OWNER, name: 'mothership'}],
    privateTokens: new Set<string>(),
    timestamp: TIMESTAMP,
    ...overrides,
  }
}

function changesOf(plan: RepoPageMovePlan): readonly PageChange[] {
  if (plan.outcome !== 'moved' && plan.outcome !== 'edited-in-place') {
    throw new Error(`expected a change set, got ${plan.outcome}`)
  }
  return plan.changes
}

function applied(plan: RepoPageMovePlan, files: Record<string, string> = snapshot()): Record<string, string> {
  return applyPageChanges(files, changesOf(plan))
}

function frontmatterOf(content: string): Record<string, unknown> {
  const match = /^---\n([\s\S]+?)\n---/u.exec(content)
  const parsed: unknown = parse(match?.[1] ?? '')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError('not frontmatter')
  return parsed as Record<string, unknown>
}

function repoSnapshots(files: Record<string, string>): WikiPageSnapshot[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith('knowledge/wiki/repos/') && path.endsWith('.md'))
    .map(([path, content]) => {
      const filename = path.slice(path.lastIndexOf('/') + 1)
      return {filename, stem: filename.replace(/\.md$/u, ''), hash: `hash-${filename}`, content}
    })
}

function publicRows(names: string[]): RepoEntry[] {
  return names.map((name, index) => ({
    owner: OWNER,
    name,
    added: '2026-09-26',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: true,
    has_renovate: true,
    discovery_channel: 'collab',
    next_survey_eligible_at: null,
    private: false,
    node_id: `NODE_${index}`,
    database_id: index + 1,
  }))
}

function leaksFor(files: Record<string, string>, publicNames: string[]) {
  return detectPrivateWikiLeaks({
    dataWikiPages: repoSnapshots(files),
    publicSlugMap: buildPublicSlugMap(publicRows(publicNames)),
    grandfatherPages: [],
  })
}

function expectBlocked(plan: RepoPageMovePlan, reason: string): void {
  expect(plan).toEqual({outcome: 'blocked', reason})
}

describe('planRepoPageMove: moving a repo page to a new slug', () => {
  it('moves the page, sets node_id and the new title, and adds the new-name source without aliases', () => {
    // #given the live-shaped legacy page (no node_id) whose sources name the old repository URL
    // #when the rename to marcusrbrown/panthea is planned
    const plan = planRepoPageMove(moveParams())
    const next = applied(plan)

    // #then the page lives at the new slug and the old path is gone
    expect(plan.outcome).toBe('moved')
    expect(next[NEW_PAGE_PATH]).toBeDefined()
    expect(next[OLD_PAGE_PATH]).toBeUndefined()
    const values = frontmatterOf(next[NEW_PAGE_PATH] ?? '')
    expect(values.node_id).toBe(NODE_ID)
    expect(values.title).toBe('marcusrbrown/panthea')
    expect(values).not.toHaveProperty('aliases')
    const urls = (values.sources as {url: string}[]).map(source => source.url)
    expect(urls).toContain(NEW_URL)
    expect(urls.filter(url => url === OLD_URL)).toHaveLength(2)
    expect(values.created).toBe('2026-09-26')
    expect(values.updated).toBe('2026-09-26')
    // node_id sits right after `updated`, where the ingest writer puts it
    expect(Object.keys(values).slice(0, 6)).toEqual(['type', 'title', 'created', 'updated', 'node_id', 'sources'])
  })

  it('records the deletion of the old page and creation of the new page as separate operations', () => {
    const changes = changesOf(planRepoPageMove(moveParams()))

    expect(changes.filter(change => change.op === 'create-page').map(change => change.path)).toEqual([NEW_PAGE_PATH])
    expect(changes.filter(change => change.op === 'delete-page').map(change => change.path)).toEqual([OLD_PAGE_PATH])
  })

  it('repairs related: entries and body wikilinks in other pages, leaving unrelated frontmatter bytes alone', () => {
    const next = applied(planRepoPageMove(moveParams()))

    const topic = next[TOPIC_PATH] ?? ''
    expect(frontmatterOf(topic).related).toEqual([NEW_SLUG, 'marcusrbrown--mothership'])
    expect(topic).toContain(`| [[${NEW_SLUG}]] | Present at the second survey | N/A |`)
    expect(topic).not.toContain(OLD_SLUG)
    // every other line of the topic page is byte-identical
    const before = topicPage().split('\n')
    const after = topic.split('\n')
    expect(after).toHaveLength(before.length)
    const differing = after.flatMap((line, index) => (line === before[index] ? [] : [index]))
    expect(differing).toHaveLength(2)
  })

  it('repairs the links inside the moved page itself', () => {
    const files = snapshot({
      [OLD_PAGE_PATH]: oldRepoPage({body: `Self reference [[${OLD_SLUG}]] and [[github-actions-ci]].`}),
    })
    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(next[NEW_PAGE_PATH]).toContain(`Self reference [[${NEW_SLUG}]]`)
    expect(next[NEW_PAGE_PATH]).not.toContain(`[[${OLD_SLUG}]]`)
  })

  it.each([
    ['[[OLD]]', '[[NEW]]'],
    ['[[OLD|the panthea page]]', '[[NEW|the panthea page]]'],
    ['[[ OLD ]]', '[[ NEW ]]'],
    ['[[ OLD | spaced label ]]', '[[ NEW | spaced label ]]'],
  ])('repairs the link form %s keeping its whitespace and label', (before, after) => {
    const body = `Intro ${before.replace('OLD', OLD_SLUG)} and more.`
    const files = snapshot({[TOPIC_PATH]: `${topicPage()}\n${body}\n`})

    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(next[TOPIC_PATH]).toContain(`Intro ${after.replace('NEW', NEW_SLUG)} and more.`)
    expect(() => validateWikilinks(wikiPagesOnly(next))).not.toThrow()
  })

  it('does not touch a link to a different page whose slug merely starts with the old slug', () => {
    const files = snapshot({
      [TOPIC_PATH]: `${topicPage()}\nSee [[${OLD_SLUG}-extra]] and [[x${OLD_SLUG}]].\n`,
      'knowledge/wiki/repos/marcusrbrown--panthe-ai-extra.md': mothershipPage().replace('R_kgDOTOX0_A', 'R_other'),
      [`knowledge/wiki/repos/x${OLD_SLUG}.md`]: mothershipPage().replace('R_kgDOTOX0_A', 'R_other2'),
    })

    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(next[TOPIC_PATH]).toContain(`[[${OLD_SLUG}-extra]] and [[x${OLD_SLUG}]]`)
  })

  it('appends exactly one manual-edit entry naming only the public old and new names, never rewriting history', () => {
    const next = applied(planRepoPageMove(moveParams()))

    const log = next[LOG_PATH] ?? ''
    expect(log.startsWith(LOG_HISTORY)).toBe(true)
    const appended = log.slice(LOG_HISTORY.length)
    expect(appended.match(/^## \[/gmu)).toHaveLength(1)
    expect(appended).toContain('## [2026-10-10 12:34] manual-edit | repo:marcusrbrown/panthea')
    expect(appended).toContain('marcusrbrown/panthe.ai')
    expect(appended).toContain('marcusrbrown/panthea')
    expect(appended).not.toContain(NODE_ID)
    // the historical line that mentions the old slug is untouched
    expect(log).toContain(`Linked [[${OLD_SLUG}]] from [[github-actions-ci]].`)
    // the log parser accepts the new entry
    expect(mergeWikiLogs([log])).toContain('manual-edit | repo:marcusrbrown/panthea')
  })

  it('rebuilds the index with the new slug, keeping the curated description and other entries', () => {
    const next = applied(planRepoPageMove(moveParams()))

    const index = next[INDEX_PATH] ?? ''
    expect(index).toContain(`- [[${NEW_SLUG}]] — Placeholder scaffold with a curated description.`)
    expect(index).not.toContain(OLD_SLUG)
    expect(index).toContain('- [[marcusrbrown--mothership]] — marcusrbrown/mothership')
    expect(index).toContain('- [[github-actions-ci]] — GitHub Actions CI')
  })

  it('never touches README.md, even when it mentions the old slug', () => {
    const changes = changesOf(planRepoPageMove(moveParams()))

    expect(changes.map(change => change.path)).not.toContain(README_PATH)
    expect(applied(planRepoPageMove(moveParams()))[README_PATH]).toBe(README_BODY)
  })

  it('touches only pages that contain a rewritten reference, plus the page, index and log', () => {
    const changes = changesOf(planRepoPageMove(moveParams()))

    const byOp = (left: string[], right: string[]): number => (left[0] ?? '').localeCompare(right[0] ?? '')
    expect(changes.map(change => [change.op, change.path]).sort(byOp)).toEqual(
      [
        ['create-page', NEW_PAGE_PATH],
        ['delete-page', OLD_PAGE_PATH],
        ['repair-links', TOPIC_PATH],
        ['write-index', INDEX_PATH],
        ['append-log', LOG_PATH],
      ].sort(byOp),
    )
    // the mothership page links only to the topic, so it is not rewritten
    expect(changes.map(change => change.path)).not.toContain(MOTHERSHIP_PATH)
  })

  it('produces a snapshot that passes validateWikilinks and the promotion attribution check', () => {
    const next = applied(planRepoPageMove(moveParams({rowName: NEW_NAME})))

    expect(() => validateWikilinks(wikiPagesOnly(next))).not.toThrow()
    expect(leaksFor(next, [NEW_NAME, 'mothership'])).toEqual([])
    // the same oracle flags the page when the attribution evidence is missing
    const unattributed = {
      ...next,
      [NEW_PAGE_PATH]: (next[NEW_PAGE_PATH] ?? '').replace(NEW_URL, 'https://github.com/x/y'),
    }
    expect(leaksFor(unattributed, [NEW_NAME, 'mothership'])).toEqual([
      {filename: `${NEW_SLUG}.md`, reason: 'unattributable-page'},
    ])
  })

  it('is deterministic', () => {
    expect(planRepoPageMove(moveParams())).toEqual(planRepoPageMove(moveParams()))
  })

  it('handles the residue state: the row already holds the new name and the page is still at the old slug', () => {
    const plan = planRepoPageMove(moveParams({rowName: NEW_NAME}))

    expect(plan.outcome).toBe('moved')
    expect(applied(plan)[NEW_PAGE_PATH]).toBeDefined()
  })

  it('adopts a legacy page whose structured sources contain the exact old repository URL, and an id-bearing page', () => {
    for (const files of [
      snapshot({[OLD_PAGE_PATH]: oldRepoPage({nodeId: null})}),
      snapshot({[OLD_PAGE_PATH]: oldRepoPage({nodeId: NODE_ID, sourceUrls: ['https://github.com/someone/else']})}),
    ]) {
      expect(planRepoPageMove(moveParams({files})).outcome).toBe('moved')
    }
  })

  it('keeps related lists in flow style repairable and deduplicates when both slugs are present', () => {
    const flowTopic = topicPage().replace(
      /related:\n {2}- .*\n {2}- .*\n/u,
      `related: [${OLD_SLUG}, ${NEW_SLUG}, marcusrbrown--mothership]\n`,
    )
    const files = snapshot({[TOPIC_PATH]: flowTopic})

    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(frontmatterOf(next[TOPIC_PATH] ?? '').related).toEqual([NEW_SLUG, 'marcusrbrown--mothership'])
  })

  it('repairs quoted related entries and keeps their quoting', () => {
    const quotedTopic = topicPage([`'${OLD_SLUG}'`, `"marcusrbrown--mothership"`])
    const files = snapshot({[TOPIC_PATH]: quotedTopic})

    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(next[TOPIC_PATH]).toContain(`  - '${NEW_SLUG}'`)
    expect(frontmatterOf(next[TOPIC_PATH] ?? '').related).toEqual([NEW_SLUG, 'marcusrbrown--mothership'])
  })
})

describe('attributesPageTo: the one ownership rule the planner, the policy and the CLI share', () => {
  const OTHER_URL = 'https://github.com/someone/else'
  const doc = (nodeId: string | null, urls: string[] | null) =>
    parseFrontmatterDocument(oldRepoPage({nodeId, sourceUrls: urls}))

  it.each([
    ['its own node_id, whatever the sources say', doc(NODE_ID, [OTHER_URL]), true],
    ['its own node_id with no sources', doc(NODE_ID, null), true],
    ['another node_id, even when the sources name the old URL', doc('R_other', [OLD_URL]), false],
    ['no node_id, with the old URL in sources', doc(null, [OLD_URL]), true],
    ['no node_id, with the old URL among others', doc(null, [OTHER_URL, OLD_URL]), true],
    ['no node_id, with only another URL', doc(null, [OTHER_URL]), false],
    ['no node_id and no sources', doc(null, null), false],
    ['no node_id, with a near-miss URL', doc(null, [`${OLD_URL}/`]), false],
  ])('%s', (_label, document, expected) => {
    expect(attributesPageTo(document, NODE_ID, OLD_URL)).toBe(expected)
  })

  it('ignores a URL that appears only in the body', () => {
    const page = `${oldRepoPage({nodeId: null, sourceUrls: [OTHER_URL]})}\nSee ${OLD_URL}.\n`

    expect(attributesPageTo(parseFrontmatterDocument(page), NODE_ID, OLD_URL)).toBe(false)
  })

  it('reads structured source URLs only, skipping entries without a string url', () => {
    const page = [
      '---',
      'type: repo',
      'sources:',
      '  - url: https://a.test',
      '  - note: no url',
      '  - 7',
      '---',
      '',
      'x',
      '',
    ].join('\n')

    expect(pageSourceUrls(parseFrontmatterDocument(page))).toEqual(['https://a.test'])
  })
})

describe('pageReflectsRename: the one already-applied definition', () => {
  const reflects = (page: string, nodeId = NODE_ID) =>
    pageReflectsRename(parseFrontmatterDocument(page), nodeId, OWNER, NEW_NAME)
  const applied = () => oldRepoPage({nodeId: NODE_ID}).replaceAll(`${OWNER}/${OLD_NAME}`, `${OWNER}/${NEW_NAME}`)

  it('is true only when node_id, title and the new source URL are all present', () => {
    expect(reflects(applied())).toBe(true)
  })

  it.each([
    ['another node_id', applied(), 'R_other'],
    ['no node_id', applied().replace(`node_id: ${NODE_ID}\n`, ''), NODE_ID],
    ['the old title', applied().replace(`title: ${OWNER}/${NEW_NAME}`, `title: ${OWNER}/${OLD_NAME}`), NODE_ID],
    [
      'only the old source URL',
      oldRepoPage({nodeId: NODE_ID}).replace(`title: ${OWNER}/${OLD_NAME}`, `title: ${OWNER}/${NEW_NAME}`),
      NODE_ID,
    ],
  ])('is false with %s', (_label, page, nodeId) => {
    expect(reflects(page, nodeId)).toBe(false)
  })
})

describe('planRepoPageMove: the bytes of a repaired related: list, per layout', () => {
  const MOTHERSHIP = 'marcusrbrown--mothership'

  /** The fixture topic with its `related:` lines replaced; the body link is left on the mothership. */
  function topicWith(relatedLines: readonly string[]): string {
    return topicPage([], `[[${MOTHERSHIP}]]`).replace('related:\n---', `${relatedLines.join('\n')}\n---`)
  }

  function repairedTopic(relatedLines: readonly string[]): string {
    const files = snapshot({[TOPIC_PATH]: topicWith(relatedLines)})
    return applied(planRepoPageMove(moveParams({files})), files)[TOPIC_PATH] ?? ''
  }

  // Layouts the text editor recognizes keep every other byte of the page; only the related lines change.
  it.each([
    {
      layout: 'block sequence',
      before: ['related:', `  - ${OLD_SLUG}`, `  - ${MOTHERSHIP}`],
      after: ['related:', `  - ${NEW_SLUG}`, `  - ${MOTHERSHIP}`],
    },
    {
      layout: 'block sequence with quotes and a trailing comment',
      before: ['related:', `  - '${OLD_SLUG}' # keep me`, `  - "${MOTHERSHIP}"`],
      after: ['related:', `  - '${NEW_SLUG}' # keep me`, `  - "${MOTHERSHIP}"`],
    },
    {
      layout: 'block sequence holding both slugs (deduplicated, first position wins)',
      before: ['related:', `  - ${OLD_SLUG}`, `  - ${NEW_SLUG}`, `  - ${MOTHERSHIP}`],
      after: ['related:', `  - ${NEW_SLUG}`, `  - ${MOTHERSHIP}`],
    },
    {
      layout: 'flow sequence',
      before: [`related: [${OLD_SLUG}, ${MOTHERSHIP}]`],
      after: [`related: [${NEW_SLUG}, ${MOTHERSHIP}]`],
    },
    {
      layout: 'flow sequence with quotes',
      before: [`related: ["${OLD_SLUG}", '${MOTHERSHIP}']`],
      after: [`related: ["${NEW_SLUG}", '${MOTHERSHIP}']`],
    },
    {
      layout: 'flow sequence holding both slugs',
      before: [`related: [${OLD_SLUG}, ${NEW_SLUG}, ${MOTHERSHIP}]`],
      after: [`related: [${NEW_SLUG}, ${MOTHERSHIP}]`],
    },
  ])('edits the text in place for a $layout', ({before, after}) => {
    expect(repairedTopic(before)).toBe(topicWith(after))
  })

  // A layout the editor does not recognize is re-rendered from the parsed document: the list is right,
  // and the frontmatter is normalized (block style) with the body trimmed to one trailing newline.
  it('re-renders the whole frontmatter for a layout the text editor does not recognize', () => {
    const unrecognized = ['related:', `  [${OLD_SLUG}, ${MOTHERSHIP}]`]

    const next = repairedTopic(unrecognized)

    expect(next).toBe(
      [
        '---',
        'type: topic',
        'title: GitHub Actions CI',
        'created: 2026-06-01',
        'updated: 2026-10-07',
        'tags:',
        '  - ci',
        'related:',
        `  - ${NEW_SLUG}`,
        `  - ${MOTHERSHIP}`,
        '---',
        '',
        '# GitHub Actions CI',
        '',
        '| Repo | Status | Notes |',
        '| --- | --- | --- |',
        `| [[${MOTHERSHIP}]] | Present at the second survey | N/A |`,
        `| [[${MOTHERSHIP}]] | Present | N/A |`,
        '',
      ].join('\n'),
    )
  })

  it('leaves a page untouched when its related: list does not name the old slug', () => {
    const files = snapshot({[TOPIC_PATH]: topicWith(['related:', `  - ${MOTHERSHIP}`])})

    const next = applied(planRepoPageMove(moveParams({files})), files)

    expect(next[TOPIC_PATH]).toBe(files[TOPIC_PATH])
  })
})

describe('planRepoPageMove: same-slug renames edit the page in place', () => {
  const SAME_SLUG_NAME = 'panthe-ai'

  it('edits the page in place: node_id, title and the added new-name source, with no move', () => {
    const plan = planRepoPageMove(moveParams({newName: SAME_SLUG_NAME}))
    const next = applied(plan)

    expect(plan.outcome).toBe('edited-in-place')
    expect(changesOf(plan).map(change => change.op)).toEqual(['edit-page', 'append-log'])
    const values = frontmatterOf(next[OLD_PAGE_PATH] ?? '')
    expect(values.node_id).toBe(NODE_ID)
    expect(values.title).toBe('marcusrbrown/panthe-ai')
    expect((values.sources as {url: string}[]).map(source => source.url)).toContain(
      'https://github.com/marcusrbrown/panthe-ai',
    )
    expect(next[INDEX_PATH]).toBe(INDEX_PAGE)
  })

  it('passes the promotion attribution oracle where the unedited page would not', () => {
    const plan = planRepoPageMove(moveParams({newName: SAME_SLUG_NAME}))

    expect(leaksFor(snapshot(), [SAME_SLUG_NAME, 'mothership'])).toEqual([
      {filename: `${OLD_SLUG}.md`, reason: 'unattributable-page'},
    ])
    expect(leaksFor(applied(plan), [SAME_SLUG_NAME, 'mothership'])).toEqual([])
  })

  it('treats a case-only rename the same way', () => {
    const plan = planRepoPageMove(moveParams({newName: 'Panthe.AI'}))

    expect(computeRepoSlug(OWNER, 'Panthe.AI')).toBe(OLD_SLUG)
    expect(plan.outcome).toBe('edited-in-place')
  })

  it('is already applied when the page, the sources and the row all carry the new name', () => {
    const edited = applied(planRepoPageMove(moveParams({newName: SAME_SLUG_NAME})))
    const plan = planRepoPageMove(moveParams({newName: SAME_SLUG_NAME, rowName: SAME_SLUG_NAME, files: edited}))

    expect(plan).toEqual({outcome: 'already-applied'})
  })

  it('blocks as page-ahead-of-row when the page was already edited but the row still holds the old name', () => {
    const edited = applied(planRepoPageMove(moveParams({newName: SAME_SLUG_NAME})))

    expectBlocked(
      planRepoPageMove(moveParams({newName: SAME_SLUG_NAME, rowName: OLD_NAME, files: edited})),
      'page-ahead-of-row',
    )
  })

  it('rewrites nothing else: no link repair is needed when the slug does not change', () => {
    const changes = changesOf(planRepoPageMove(moveParams({newName: SAME_SLUG_NAME})))

    expect(changes.map(change => change.path)).toEqual([OLD_PAGE_PATH, LOG_PATH])
  })
})

describe('planRepoPageMove: preconditions', () => {
  it('blocks a legacy page whose body names the old repo but whose sources name another repository', () => {
    const files = snapshot({
      [OLD_PAGE_PATH]: oldRepoPage({
        sourceUrls: ['https://github.com/someone/else'],
        body: `Notes about ${OLD_URL} in prose only.`,
      }),
    })

    expectBlocked(planRepoPageMove(moveParams({files})), 'old-page-not-attributed')
  })

  it('blocks a legacy page with no structured sources, even when the body contains the URL', () => {
    const files = snapshot({[OLD_PAGE_PATH]: oldRepoPage({sourceUrls: null, body: `Notes about ${OLD_URL}.`})})

    expectBlocked(planRepoPageMove(moveParams({files})), 'old-page-not-attributed')
  })

  it('blocks a page whose sources contain only a prefix, a different case or a different path of the old URL', () => {
    for (const url of [`${OLD_URL}/blob/main/README.md`, OLD_URL.toUpperCase(), `${OLD_URL}-fork`]) {
      const files = snapshot({[OLD_PAGE_PATH]: oldRepoPage({sourceUrls: [url]})})
      expectBlocked(planRepoPageMove(moveParams({files})), 'old-page-not-attributed')
    }
  })

  it('blocks a page that carries a different node_id, whatever its sources say', () => {
    const files = snapshot({[OLD_PAGE_PATH]: oldRepoPage({nodeId: 'R_someoneElse'})})

    expectBlocked(planRepoPageMove(moveParams({files})), 'old-page-not-attributed')
  })

  it('blocks when the target page exists with a different node_id, with no node_id, or with the same node_id and the row unrenamed', () => {
    const cases: [string | null, string, string][] = [
      ['R_someoneElse', OLD_NAME, 'both-pages-present'],
      [null, OLD_NAME, 'both-pages-present'],
      [NODE_ID, OLD_NAME, 'both-pages-present'],
    ]
    for (const [nodeId, rowName, reason] of cases) {
      const target = oldRepoPage({nodeId}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
      expectBlocked(planRepoPageMove(moveParams({files: snapshot({[NEW_PAGE_PATH]: target}), rowName})), reason)
    }
  })

  it('blocks as page-ahead-of-row when only the target page exists and the row still holds the old name', () => {
    const target = oldRepoPage({nodeId: NODE_ID}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const files = snapshot({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: target})

    expectBlocked(planRepoPageMove(moveParams({files, rowName: OLD_NAME})), 'page-ahead-of-row')
  })

  it('blocks when only the target page exists, the row holds the new name, and the page belongs to someone else', () => {
    for (const nodeId of ['R_someoneElse', null]) {
      const target = oldRepoPage({nodeId}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
      const files = snapshot({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: target})

      expectBlocked(planRepoPageMove(moveParams({files, rowName: NEW_NAME})), 'target-page-occupied')
    }
  })

  it('is already applied when only the target page exists, carries the row node_id, and the row holds the new name', () => {
    const target = oldRepoPage({nodeId: NODE_ID}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const files = snapshot({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: target})

    expect(planRepoPageMove(moveParams({files, rowName: NEW_NAME}))).toEqual({outcome: 'already-applied'})
  })

  it('blocks when another row maps to the old slug', () => {
    const otherRows = [{owner: OWNER, name: 'Panthe-AI'}]

    expectBlocked(planRepoPageMove(moveParams({otherRows})), 'slug-collision')
  })

  it('blocks when another row maps to the new slug', () => {
    const otherRows = [{owner: OWNER, name: 'PANTHEA'}]

    expectBlocked(planRepoPageMove(moveParams({otherRows})), 'slug-collision')
  })

  it('does not treat a redacted row as a slug collision', () => {
    const otherRows = [{owner: '[REDACTED]', name: 'R_kgDOabc'}]

    expect(planRepoPageMove(moveParams({otherRows})).outcome).toBe('moved')
  })

  it('blocks when the new name matches a private repository token', () => {
    const privateTokens = buildPrivateTokenSet(['marcusrbrown/panthea'])

    expectBlocked(planRepoPageMove(moveParams({privateTokens})), 'private-name-collision')
  })

  it('blocks a case variant of a private token', () => {
    const privateTokens = buildPrivateTokenSet(['MarcusRBrown/PANTHEA'])

    expectBlocked(planRepoPageMove(moveParams({privateTokens})), 'private-name-collision')
  })

  it('blocks when only the slug form of the new name matches a private token', () => {
    const privateTokens = buildPrivateTokenSet(['marcusrbrown/Pan.thea'])
    const plan = planRepoPageMove(moveParams({newName: 'pan-thea', privateTokens}))

    expectBlocked(plan, 'private-name-collision')
  })

  it('does not block on unrelated private tokens', () => {
    const privateTokens = buildPrivateTokenSet(['marcusrbrown/secret-project'])

    expect(planRepoPageMove(moveParams({privateTokens})).outcome).toBe('moved')
  })

  it('never puts a private token in its output, even when it blocks on one', () => {
    const privateName = 'marcusrbrown/panthea'
    const plan = planRepoPageMove(moveParams({privateTokens: buildPrivateTokenSet([privateName])}))

    // the reason is a fixed code; the private identifier is not echoed
    expect(JSON.stringify(plan)).toBe('{"outcome":"blocked","reason":"private-name-collision"}')
  })

  it('returns metadata-only when the old page is absent', () => {
    const files = snapshot({[OLD_PAGE_PATH]: null})

    expect(planRepoPageMove(moveParams({files}))).toEqual({outcome: 'metadata-only'})
  })

  it('blocks when any page fails to parse', () => {
    const files = snapshot({'knowledge/wiki/topics/broken.md': 'no frontmatter here\n'})

    expectBlocked(planRepoPageMove(moveParams({files})), 'unparseable-page')
  })

  it('blocks when the frontmatter YAML is invalid', () => {
    const files = snapshot({'knowledge/wiki/topics/broken.md': '---\nkey: [unterminated\n---\n\nBody.\n'})

    expectBlocked(planRepoPageMove(moveParams({files})), 'unparseable-page')
  })

  it('blocks when the repaired snapshot fails wikilink validation (a heading link to the old slug)', () => {
    const files = snapshot({[TOPIC_PATH]: `${topicPage()}\nSee [[${OLD_SLUG}#history]].\n`})

    expectBlocked(planRepoPageMove(moveParams({files})), 'invalid-wikilinks')
  })

  it('blocks when a page lacks the frontmatter fields the index needs', () => {
    const files = snapshot({'knowledge/wiki/topics/thin.md': '---\ntitle: Thin\n---\n\nBody.\n'})

    expectBlocked(planRepoPageMove(moveParams({files})), 'invalid-index')
  })

  it('blocks a name that sanitizes to an empty slug', () => {
    expectBlocked(planRepoPageMove(moveParams({newName: '...'})), 'invalid-name')
  })

  it('ignores non-page files and pages outside the four wiki sections', () => {
    const files = snapshot({
      'knowledge/wiki/repos/.gitkeep': '',
      'knowledge/wiki/notes/stray.md': 'no frontmatter\n',
      'metadata/repos.yaml': 'version: 1\n',
    })

    expect(planRepoPageMove(moveParams({files})).outcome).toBe('moved')
  })
})

describe('applyPageChanges', () => {
  it('applies writes and deletions without mutating its input', () => {
    const input = {'a.md': 'a', 'b.md': 'b'}

    const next = applyPageChanges(input, [
      {op: 'create-page', path: 'c.md', content: 'c'},
      {op: 'delete-page', path: 'a.md'},
    ])

    expect(next).toEqual({'b.md': 'b', 'c.md': 'c'})
    expect(input).toEqual({'a.md': 'a', 'b.md': 'b'})
  })
})

function wikiPagesOnly(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\//u.test(path)),
  )
}
