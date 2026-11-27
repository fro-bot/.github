import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const repositoryRoot = resolve(import.meta.dirname, '..')
const skillsDirectory = resolve(repositoryRoot, '.agents/skills')

interface SkillFile {
  readonly directory: string
  readonly frontmatter: Record<string, unknown>
  readonly body: string
}

function readSkill(directory: string): SkillFile {
  const text = readFileSync(resolve(skillsDirectory, directory, 'SKILL.md'), 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (match === null) throw new Error(`${directory}/SKILL.md has no frontmatter block`)
  const frontmatter: unknown = parse(match[1] ?? '')
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new TypeError(`${directory}/SKILL.md frontmatter is not a mapping`)
  }
  return {directory, frontmatter: frontmatter as Record<string, unknown>, body: match[2] ?? ''}
}

const skillDirectories = readdirSync(skillsDirectory, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

describe('repo-scoped agent skills', () => {
  it.each(skillDirectories)('%s has frontmatter with a matching name and a "Use when" description', directory => {
    const {frontmatter} = readSkill(directory)

    expect(frontmatter.name).toBe(directory)
    expect(directory).toMatch(/^[a-z0-9-]+$/i)
    expect(typeof frontmatter.description).toBe('string')
    expect(String(frontmatter.description)).toMatch(/^Use when /)
  })

  it.each(skillDirectories)('%s is listed in the skills table of .agents/README.md', directory => {
    const readme = readFileSync(resolve(repositoryRoot, '.agents/README.md'), 'utf8')

    expect(readme).toContain(`[\`${directory}\`](skills/${directory}/SKILL.md)`)
  })
})

describe('the cross-repo-program skill', () => {
  it('exists where the tracker prompts read it', () => {
    expect(existsSync(resolve(skillsDirectory, 'cross-repo-program/SKILL.md'))).toBe(true)
  })

  it('covers every phase of a program', () => {
    const {body} = readSkill('cross-repo-program')
    const headings = [...body.matchAll(/^#{2,3} (.+)$/gm)].map(match => match[1])

    expect(headings).toEqual(
      expect.arrayContaining([
        'Start a program',
        'The config entry',
        'The Project',
        'Dependencies',
        'Acceptance gates and evidence',
        'Handing a step to the operator',
        'Domain programs and their goals',
        'Per-repo work',
        'Keep it current',
        'Close a program out',
      ]),
    )
  })

  it('names the files it relies on and the evidence rule', () => {
    const {body} = readSkill('cross-repo-program')

    expect(body).toContain('program-trackers.json')
    expect(body).toContain('packages/status-truth/src/rollout-tracker-snapshot.ts')
    expect(body).toContain('.github/workflows/gateway-rollout-tracker.yaml')
    expect(body).toContain('packages/dispatch')
    expect(body).toMatch(/operator-reported/)
    expect(body).toMatch(/agent-verified/)
  })

  it('labels the tracker issue program-tracker when the start run creates it, and bootstrap keeps its own label step', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain('Create the tracker issue with the `program-tracker` label and an empty Project')
    expect(text).toContain('Routing comes from the config, so the label is safe to apply early')
    expect(text).toContain('labels the issue `program-tracker` if it lacks the label')
  })

  it('searches configured programs and open program-tracker issues that have an open start PR', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain(
      'Read `program-trackers.json`, then search open issues labeled `program-tracker` that have an open start PR',
    )
    expect(text).toContain('A pending start counts as an existing program')
  })

  it('tells the operator to close the issue and delete the Project when a start PR is closed unmerged', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain(
      'If a start PR is closed without merging, close its tracker issue and delete its Project. The PR body names both.',
    )
  })

  it('says requests go in comments and a body edit is not read as a request', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain(
      'Requests go in comments on the tracker issue that mention `@fro-bot`. Edits to an earlier comment are read too.',
    )
    expect(text).toContain('An edit to the issue body is never read as a request')
    expect(text).toContain('the content job skips the operator')
  })

  it('has bootstrap search for and reuse an existing issue, recheck visibility and report blocked repos', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain(
      'searches the repo for an open issue by `fro-bot` that links the tracker issue and reuses it',
    )
    expect(text).toContain(
      'rereads the config on the default branch and skips the repo, silently, unless the program and the repo are still confirmed there',
    )
    expect(text).toContain('rechecks that the repo is still `PUBLIC` right before it acts')
    expect(text).toContain('an empty `programs` array is valid')
    expect(text).toContain(
      'A repo with issues disabled is listed once as an operator step and never wakes the tracker by itself',
    )
  })

  it('has the tracker write only about items in the public item set', () => {
    const {body} = readSkill('cross-repo-program')
    const text = body.replaceAll(/\s+/g, ' ')

    expect(text).toContain(
      "The tracker names, counts and describes only the items in the preflight's `public_items` set",
    )
  })

  it('keeps plan, review and agent names out of the text', () => {
    const {body, frontmatter} = readSkill('cross-repo-program')
    const text = `${String(frontmatter.description)}\n${body}`

    expect(text).not.toMatch(/docs\/plans\//)
    expect(text).not.toMatch(/docs\/brainstorms\//)
    expect(text).not.toMatch(/\bsubagent\b/i)
  })
})

describe('the cross-repo-program skill: a domain program', () => {
  const {body} = readSkill('cross-repo-program')
  const section = body.split(/^## /m).find(part => part.startsWith('Domain programs and their goals')) ?? ''
  const flat = section.replaceAll(/\s+/g, ' ')

  it('has the section', () => {
    expect(section).not.toBe('')
  })

  it('has the start step accept or decline an offered program with a reason, and stop at the pull request', () => {
    expect(flat).toContain('accepts or declines the offer with a reason')
    expect(flat).toContain('before any repository work starts')
    expect(flat).toContain('`domain`')
    expect(flat).toContain('stops at the pull request')
  })

  it('gives the goals to the tracker, never to the start run', () => {
    expect(flat).toContain('The start run opens no goal')
    expect(flat).toContain('`goal_batches`')
    expect(flat).toContain('after the start pull request merges')
  })

  it('names the goal issue, its batch key, its label and the Project', () => {
    expect(flat).toContain('`cross-repo-goal`')
    expect(flat).toContain('<!-- fro-bot-program-goal program:<key> batch:<name> -->')
    expect(flat).toContain("added to the program's Project")
    expect(flat).toContain('as `fro-bot`')
  })

  it('names the checklist line format with the pinned commit and its limit', () => {
    expect(flat).toContain('`owner/repo: <ask>. Brief: program-domains.json@<sha>#<domain>. Part issue: <url>`')
    expect(flat).toContain('4,000')
  })

  it('says when each batch is listed: the first once every part issue exists, then one for each Part 0 repo whose Part 0 merged', () => {
    expect(flat).toContain('the first batch')
    expect(flat).toContain('every part issue exists')
    expect(flat).toContain('Part 0')
    expect(flat).toContain('merged')
  })

  it('says Part 0 is a merged pull request in that repo that references the part issue, and a later repo joins as its own batch', () => {
    expect(flat).toContain('merged pull request in that repository that references the part issue')
    expect(flat).toContain('`join-<node ID>`')
    expect(flat).toContain('and its brief commit are fixed when it is created')
    expect(flat).toContain('never posts a subset checklist, a second one, or one at another commit')
  })

  it('says a transient brief read failure holds an item and a mismatch blocks it for good', () => {
    expect(flat).toContain('read that fails (the brief, or the live repository) leaves the item pending and held')
    expect(flat).toContain('blocks it for good')
    expect(flat).toContain('remove and reapply dispatch-approved to retry')
    expect(flat).not.toContain('the next dispatch run retries')
  })

  it('says a batch is repaired by reusing its goal and writing only what is missing', () => {
    expect(flat).toContain('reuses the goal')
    expect(flat).toContain('only what is missing')
  })

  it('says each goal is approved by the operator and keeps the commit it was approved with', () => {
    expect(flat).toContain('`dispatch-approved`')
    expect(flat).toContain('keeps the brief commit')
    expect(flat).toContain('its own approval')
  })

  it('says the planner skips the goal and dispatch checks the target against the brief', () => {
    expect(flat).toContain('The planner skips')
    expect(flat).toContain('dispatch checks')
  })
})

describe('the cross-repo-program skill: a start from a program proposal', () => {
  const {body} = readSkill('cross-repo-program')
  const section = body.split(/^## /m).find(part => part.startsWith('Domain programs and their goals')) ?? ''
  const flat = section.replaceAll(/\s+/g, ' ')

  it('says the operator label starts it, through the program-approved workflow, and that the proposal is data', () => {
    expect(flat).toContain('A start from a program proposal')
    expect(flat).toContain('`.github/workflows/program-approved.yaml`')
    expect(flat).toContain("the operator's `program-approved` label")
    expect(flat).toContain('the proposal is data')
    expect(flat).toContain('read the domain and its brief on `main` yourself')
  })

  it('re-checks the approval before it creates anything, and stops when it does not hold', () => {
    expect(flat).toContain(
      'Before you create anything, re-check that the proposal is open and still carries `program-approved`',
    )
    expect(flat).toContain(
      'the newest `labeled` event for it was made by `marcusrbrown`, with no later `unlabeled` event',
    )
    expect(flat).toContain('If any of that fails, stop and create nothing')
  })

  it('accepts or declines with a reason before any repository work starts', () => {
    expect(flat).toContain('accept or decline it with a reason before any repository work starts')
  })

  it('on accept puts the proposal URL in the start pull request body, then closes the proposal naming the tracker', () => {
    expect(flat).toContain("put the proposal's URL in the start pull request body")
    expect(flat).toContain('close the proposal with a comment that names the tracker issue')
  })

  it('closes a proposal as already covered, linking the tracker, when an existing program covers its domain', () => {
    expect(flat).toContain('If an existing program already covers the domain')
    expect(flat).toContain('close the proposal as already covered, with a comment that links that program')
  })

  it('on decline comments the reason and leaves the proposal open for the operator', () => {
    expect(flat).toContain('on decline, comment the reason and leave the proposal open for the operator')
  })

  it('says a failed run leaves the proposal open and the operator reapplies the label', () => {
    expect(flat).toContain(
      'A failed run leaves the proposal open: the operator removes and reapplies `program-approved`',
    )
  })

  it('puts the proposal URL in the tracker issue body from creation, and the Project URL there as soon as the Project exists', () => {
    expect(flat).toContain("carries the proposal's URL from the moment you create it")
    expect(flat).toContain("record the Project's URL in the tracker issue body as soon as the Project exists")
  })

  it('searches for fro-bot program-tracker issues that hold the proposal URL, in every state and by exact body match, before creating anything', () => {
    const search =
      '`gh issue list --repo fro-bot/.github --label program-tracker --author fro-bot --state all --search "<proposal URL> in:body" --limit 100 --json url,number,state,body`'

    expect(flat).toContain(
      'Before you create anything, step 1 also searches for a leftover of an earlier start from this proposal',
    )
    expect(flat).toContain(search)
    expect(flat).toContain('keeping only issues whose body itself contains the proposal URL')
    expect(flat.indexOf(search)).toBeLessThan(flat.indexOf('On accept, start as above'))
  })

  it('resumes exactly one open match: its tracker and recorded Project are reused, only what is missing is created', () => {
    expect(flat).toContain(
      'with exactly one open match, resume it: reuse that tracker issue and the Project its body records, create only what is missing, and open the start pull request if none is open',
    )
    expect(flat).toContain('a resumed match is not reported as already covered')
    expect(flat).toContain(
      'if its start pull request already merged, the config covers the domain, so close the proposal as already covered',
    )
  })

  it('ignores closed matches beside exactly one open match, but stops when only closed matches exist', () => {
    expect(flat).toContain('closed matches beside that one are ignored leftovers')
    expect(flat).toContain(
      'more than one open match, a recorded Project that cannot be read, a failed search, or closed matches with no open match',
    )
    expect(flat).not.toContain('a closed match, more than one match')
  })

  it('creates nothing on a stop, and gives the operator two explicit paths: resume or abandon', () => {
    expect(flat).toContain("create nothing and comment on the proposal with the links and the operator's two paths")
    expect(flat).toContain(
      'resume: repair the canonical tracker (reopen it if closed, record its Project URL in its body), close any other leftover trackers, then reapply `program-approved`',
    )
    expect(flat).toContain('abandon: close the proposal')
    expect(flat).not.toContain('close or fix the leftovers')
  })

  it('names no reply prefix, pickup or dispatch from Observe any more', () => {
    expect(flat).not.toContain('Program start accepted')
    expect(flat).not.toContain('Program start declined')
    expect(flat).not.toContain('daily pass')
    expect(flat).not.toContain('start in progress')
  })
})
