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
