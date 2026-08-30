import type {WikiLintFinding} from './wiki-lint.ts'

import {readFile, writeFile} from 'node:fs/promises'
import {parse, stringify} from 'yaml'

import {maskNonProseContent} from './rendering-policy.ts'
import {collectWikiPages} from './wiki-utils.ts'

/** System-owned sidecar state; it is deliberately outside rendered page content. */
export const CORRECTIONS_PATH = 'knowledge/corrections.yaml' as const

export const CORRECTIONS_VERSION = 1 as const

export type CorrectionLifecycle = 'active' | 'superseded' | 'retired' | 'needs-reconfirmation'

/** The text span is the durable constraint consumed by the future survival check. */
export interface CorrectionSpan {
  readonly text: string
  readonly start?: number
  readonly end?: number
}

/** Attribution is populated from the authenticated server session, never page input. */
export interface CorrectionAttribution {
  readonly actor: string
  readonly recorded_at: string
}

export interface CorrectionRecord {
  readonly id: string
  readonly page_node_id: string
  readonly span: CorrectionSpan
  /** Optional during the loose rollout phase; new writes always include it. The tight phase will require it. */
  readonly attribution?: CorrectionAttribution
  /** Optional during the loose rollout phase; new writes always include `active`. The tight phase will require it. */
  readonly state?: CorrectionLifecycle
  readonly superseded_by?: string
}

export interface CorrectionsFile {
  readonly version: typeof CORRECTIONS_VERSION
  readonly corrections: readonly CorrectionRecord[]
}

export interface RecordCorrectionInput {
  readonly id: string
  readonly pageNodeId: string
  readonly span: CorrectionSpan
  /** This value must come from the broker's authenticated server session. */
  readonly serverDerivedAttribution: CorrectionAttribution
  readonly supersedesId?: string
}

export interface CorrectionsReadResult {
  readonly corrections: CorrectionsFile
  readonly warnings: readonly string[]
}

export interface CorrectionSurvivalResult {
  readonly ok: boolean
  readonly deterministicFindings: readonly WikiLintFinding[]
  readonly advisoryFindings: readonly WikiLintFinding[]
}

export type ReadUtf8File = (path: string, encoding: 'utf8') => Promise<string>
export type WriteUtf8File = (path: string, content: string, encoding: 'utf8') => Promise<void>

export type CorrectionStoreErrorCode =
  'INVALID_CORRECTIONS' | 'CORRECTION_NOT_FOUND' | 'INVALID_TRANSITION' | 'READ_FAILED' | 'WRITE_FAILED'

export class CorrectionStoreError extends Error {
  readonly code: CorrectionStoreErrorCode
  readonly path: string

  constructor(params: {code: CorrectionStoreErrorCode; path: string; message: string}) {
    super(params.message)
    this.name = 'CorrectionStoreError'
    this.code = params.code
    this.path = params.path
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCorrectionLifecycle(value: unknown): value is CorrectionLifecycle {
  return value === 'active' || value === 'superseded' || value === 'retired' || value === 'needs-reconfirmation'
}

function isCorrectionSpan(value: unknown): value is CorrectionSpan {
  if (!isRecord(value) || typeof value.text !== 'string' || value.text.length === 0) return false
  const start = value.start
  const end = value.end
  if (start !== undefined && (typeof start !== 'number' || !Number.isInteger(start) || start < 0)) return false
  if (end !== undefined && (typeof end !== 'number' || !Number.isInteger(end) || end < 0)) return false
  if (typeof start === 'number' && typeof end === 'number' && end < start) return false
  return true
}

function isCorrectionAttribution(value: unknown): value is CorrectionAttribution {
  return (
    isRecord(value) &&
    typeof value.actor === 'string' &&
    value.actor.length > 0 &&
    typeof value.recorded_at === 'string' &&
    value.recorded_at.length > 0
  )
}

function isCorrectionRecord(value: unknown): value is CorrectionRecord {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.page_node_id !== 'string' || value.page_node_id.length === 0) return false
  if (!isCorrectionSpan(value.span)) return false
  if (value.attribution !== undefined && !isCorrectionAttribution(value.attribution)) return false
  if (value.state !== undefined && !isCorrectionLifecycle(value.state)) return false
  if (
    value.superseded_by !== undefined &&
    (typeof value.superseded_by !== 'string' || value.superseded_by.length === 0)
  )
    return false
  return true
}

export function isCorrectionsFile(value: unknown): value is CorrectionsFile {
  return (
    isRecord(value) &&
    value.version === CORRECTIONS_VERSION &&
    Array.isArray(value.corrections) &&
    value.corrections.every(isCorrectionRecord)
  )
}

export function assertCorrectionsFile(value: unknown, path = 'corrections'): asserts value is CorrectionsFile {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (value.version !== CORRECTIONS_VERSION)
    throw invalidCorrections(`${path}.version`, `expected ${CORRECTIONS_VERSION}`)
  if (!Array.isArray(value.corrections)) throw invalidCorrections(`${path}.corrections`, 'expected array')
  value.corrections.forEach((entry, index) => assertCorrectionRecord(entry, `${path}.corrections[${index}]`))
}

function assertCorrectionRecord(value: unknown, path: string): asserts value is CorrectionRecord {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (typeof value.id !== 'string' || value.id.length === 0)
    throw invalidCorrections(`${path}.id`, 'expected non-empty string')
  if (typeof value.page_node_id !== 'string' || value.page_node_id.length === 0)
    throw invalidCorrections(`${path}.page_node_id`, 'expected non-empty string')
  assertCorrectionSpan(value.span, `${path}.span`)
  if (value.attribution !== undefined) assertCorrectionAttribution(value.attribution, `${path}.attribution`)
  if (value.state !== undefined && !isCorrectionLifecycle(value.state))
    throw invalidCorrections(`${path}.state`, 'expected active, superseded, retired, or needs-reconfirmation')
  if (
    value.superseded_by !== undefined &&
    (typeof value.superseded_by !== 'string' || value.superseded_by.length === 0)
  )
    throw invalidCorrections(`${path}.superseded_by`, 'expected non-empty string')
}

function assertCorrectionSpan(value: unknown, path: string): asserts value is CorrectionSpan {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (typeof value.text !== 'string' || value.text.length === 0)
    throw invalidCorrections(`${path}.text`, 'expected non-empty string')
  const start = value.start
  const end = value.end
  if (start !== undefined && (!Number.isInteger(start) || typeof start !== 'number' || start < 0))
    throw invalidCorrections(`${path}.start`, 'expected non-negative integer')
  if (end !== undefined && (!Number.isInteger(end) || typeof end !== 'number' || end < 0))
    throw invalidCorrections(`${path}.end`, 'expected non-negative integer')
  if (typeof start === 'number' && typeof end === 'number' && end < start)
    throw invalidCorrections(path, 'end must be greater than or equal to start')
}

function assertCorrectionAttribution(value: unknown, path: string): asserts value is CorrectionAttribution {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (typeof value.actor !== 'string' || value.actor.length === 0)
    throw invalidCorrections(`${path}.actor`, 'expected non-empty server-derived identity')
  if (typeof value.recorded_at !== 'string' || value.recorded_at.length === 0)
    throw invalidCorrections(`${path}.recorded_at`, 'expected non-empty timestamp')
}

function invalidCorrections(path: string, message: string): CorrectionStoreError {
  return new CorrectionStoreError({
    code: 'INVALID_CORRECTIONS',
    path,
    message: `${path}: ${message}`,
  })
}

const emptyCorrectionsFile = (): CorrectionsFile => ({version: CORRECTIONS_VERSION, corrections: []})

export function parseCorrections(raw: string): CorrectionsFile {
  const value: unknown = parse(raw)
  assertCorrectionsFile(value)
  return value
}

export function serializeCorrections(value: unknown): string {
  assertCorrectionsFile(value)
  return stringify(value)
}

export async function readCorrections(
  readFileImpl: ReadUtf8File = async (path, encoding) => readFile(path, encoding),
  warn: (message: string) => void = () => undefined,
  path = CORRECTIONS_PATH,
): Promise<CorrectionsReadResult> {
  let raw: string
  try {
    raw = await readFileImpl(path, 'utf8')
  } catch (error: unknown) {
    // ENOENT means there is nothing to enforce during first-write bootstrap. Any other
    // read failure means we cannot prove corrections survived, so it must fail closed.
    if (isMissingFileError(error)) return {corrections: emptyCorrectionsFile(), warnings: []}
    const storeError = new CorrectionStoreError({
      code: 'READ_FAILED',
      path,
      message: `corrections: unable to read ${path}`,
    })
    warn(storeError.message)
    throw storeError
  }

  if (raw.trim() === '') {
    const storeError = invalidCorrections(path, 'existing file is empty')
    warn(storeError.message)
    throw storeError
  }

  try {
    return {corrections: parseCorrections(raw), warnings: []}
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'invalid YAML or schema'
    const storeError = invalidCorrections(path, `unable to parse existing file (${detail})`)
    warn(storeError.message)
    throw storeError
  }
}

/**
 * Verify marked spans mechanically after ingest regeneration.
 *
 * Matching trims the span and collapses every whitespace run to one space, then
 * performs an exact substring search in prose only. Fenced code, indented code,
 * and blockquotes are excluded because quoted material is not evidence that the
 * correction survived in the page's actual prose.
 *
 * If exact prose matching fails, a second conservative comparison replaces
 * Markdown links with their visible text, removes Markdown emphasis/code markers,
 * converts punctuation to whitespace, collapses whitespace, and lowercases text.
 * A match under that rule is formatting-only drift and emits an advisory
 * `correction-needs-reconfirmation`; any other miss is erosion and blocks ingest.
 */
export function verifyCorrectionSurvival(
  files: Record<string, string>,
  corrections: CorrectionsFile | undefined,
  fallbackFiles: Record<string, string> = {},
): CorrectionSurvivalResult {
  if (corrections === undefined) return {ok: true, deterministicFindings: [], advisoryFindings: []}

  assertCorrectionsFile(corrections)
  const pages = collectWikiPages(files)
  const fallbackPages = collectWikiPages(fallbackFiles)
  const pagesByNodeId = new Map<string, (typeof pages)[number]>()
  const fallbackPagesByNodeId = new Map<string, (typeof fallbackPages)[number]>()
  for (const page of pages) {
    const nodeId = page.frontmatter.node_id
    if (typeof nodeId === 'string' && nodeId !== '') pagesByNodeId.set(nodeId, page)
  }
  for (const page of fallbackPages) {
    const nodeId = page.frontmatter.node_id
    if (typeof nodeId === 'string' && nodeId !== '') fallbackPagesByNodeId.set(nodeId, page)
  }

  const deterministicFindings: WikiLintFinding[] = []
  const advisoryFindings: WikiLintFinding[] = []
  for (const correction of corrections.corrections) {
    const state = getCorrectionLifecycle(correction)
    if (state === 'superseded' || state === 'retired') continue

    const page = pagesByNodeId.get(correction.page_node_id)
    const fallbackPage = fallbackPagesByNodeId.get(correction.page_node_id)
    const path = page?.path ?? fallbackPage?.path ?? CORRECTIONS_PATH
    if (state === 'needs-reconfirmation') {
      advisoryFindings.push({
        kind: 'correction-needs-reconfirmation',
        path,
        target: correction.id,
        message: `Correction ${correction.id} needs operator reconfirmation before it is enforced.`,
      })
      continue
    }

    const normalizedSpan = normalizeCorrectionText(correction.span.text)
    const proseBody = page === undefined ? '' : maskNonProseContent(page.body)
    const normalizedBody = normalizeCorrectionText(maskMarkdownLinks(proseBody))
    if (page === undefined || normalizedSpan === '' || !normalizedBody.includes(normalizedSpan)) {
      const formattingSpan = normalizeFormattingText(correction.span.text)
      const formattingBody = normalizeFormattingText(proseBody)
      if (formattingSpan !== '' && formattingBody.includes(formattingSpan)) {
        advisoryFindings.push({
          kind: 'correction-needs-reconfirmation',
          path,
          target: correction.id,
          message: `Correction ${correction.id} appears preserved with formatting-only changes and needs operator reconfirmation.`,
        })
        continue
      }
      deterministicFindings.push({
        kind: 'correction-eroded',
        path,
        target: correction.id,
        message: `Active correction ${correction.id} was not found in the regenerated page.`,
      })
    }
  }

  return {
    ok: deterministicFindings.length === 0,
    deterministicFindings,
    advisoryFindings,
  }
}

function normalizeCorrectionText(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ')
}

function normalizeFormattingText(value: string): string {
  const markdownLinkPattern = /!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu
  return value
    .normalize('NFKC')
    .replaceAll(markdownLinkPattern, renderVisibleLinkText)
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase()
}

function renderVisibleLinkText(
  _match: string,
  markdownText: string | undefined,
  wikiTarget: string | undefined,
  wikiLabel: string | undefined,
): string {
  return markdownText ?? wikiLabel ?? wikiTarget ?? ''
}

function maskMarkdownLinks(content: string): string {
  const masked = content.split('')
  let open = -1
  let index = 0
  while (index < content.length) {
    if (content[index] === '[') open = index
    if (content[index] === ']' && content[index + 1] === '(' && open !== -1) {
      let close = index + 2
      let depth = 1
      while (close < content.length && depth > 0) {
        if (content[close] === '(') depth += 1
        else if (content[close] === ')') depth -= 1
        close += 1
      }
      if (depth === 0) {
        for (let maskIndex = open; maskIndex < close; maskIndex += 1) masked[maskIndex] = ' '
        index = close
        open = -1
        continue
      }
    }
    index += 1
  }
  return masked.join('')
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

export async function writeCorrections(
  value: unknown,
  writeFileImpl: WriteUtf8File = async (path, content, encoding) => writeFile(path, content, encoding),
  path = CORRECTIONS_PATH,
): Promise<void> {
  const content = serializeCorrections(value)
  try {
    await writeFileImpl(path, content, 'utf8')
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown write failure'
    throw new CorrectionStoreError({
      code: 'WRITE_FAILED',
      path,
      message: `corrections: unable to write ${path}: ${detail}`,
    })
  }
}

export function recordCorrection(file: CorrectionsFile, input: RecordCorrectionInput): CorrectionsFile {
  assertCorrectionsFile(file)
  if (file.corrections.some(correction => correction.id === input.id))
    throw new CorrectionStoreError({
      code: 'INVALID_CORRECTIONS',
      path: 'corrections',
      message: `corrections: duplicate correction id ${input.id}`,
    })
  if (input.supersedesId !== undefined) {
    const superseded = file.corrections.find(correction => correction.id === input.supersedesId)
    if (superseded === undefined) throw correctionNotFound(input.supersedesId)
    if (superseded.state === 'retired' || superseded.state === 'superseded')
      throw new CorrectionStoreError({
        code: 'INVALID_TRANSITION',
        path: 'corrections',
        message: `corrections: ${superseded.state} correction ${input.supersedesId} cannot be superseded`,
      })
  }

  const corrections = file.corrections.map(correction =>
    correction.id === input.supersedesId
      ? {...correction, state: 'superseded' as const, superseded_by: input.id}
      : correction,
  )
  corrections.push({
    id: input.id,
    page_node_id: input.pageNodeId,
    span: input.span,
    attribution: input.serverDerivedAttribution,
    state: 'active',
  })
  const result: CorrectionsFile = {version: CORRECTIONS_VERSION, corrections}
  assertCorrectionsFile(result)
  return result
}

export function getCorrectionsForPage(file: CorrectionsFile, pageNodeId: string): CorrectionRecord[] {
  assertCorrectionsFile(file)
  return file.corrections.filter(correction => correction.page_node_id === pageNodeId)
}

/** Legacy records without the optional state field remain active until explicitly transitioned. */
export function getCorrectionLifecycle(correction: CorrectionRecord): CorrectionLifecycle {
  return correction.state ?? 'active'
}

export function transitionCorrection(
  file: CorrectionsFile,
  id: string,
  state: CorrectionLifecycle,
  supersededBy?: string,
): CorrectionsFile {
  assertCorrectionsFile(file)
  const index = file.corrections.findIndex(correction => correction.id === id)
  if (index === -1) throw correctionNotFound(id)
  const current = file.corrections[index]
  if (current === undefined) throw correctionNotFound(id)
  if (current.state === 'retired' || current.state === 'superseded')
    throw new CorrectionStoreError({
      code: 'INVALID_TRANSITION',
      path: `corrections[${index}].state`,
      message: `corrections: ${current.state} correction ${id} cannot transition`,
    })
  if (state === 'superseded' && (supersededBy === undefined || supersededBy.length === 0))
    throw new CorrectionStoreError({
      code: 'INVALID_TRANSITION',
      path: `corrections[${index}].superseded_by`,
      message: 'corrections: superseded corrections require supersededBy',
    })
  const next = {...current, state, ...(state === 'superseded' ? {superseded_by: supersededBy} : {})}
  const corrections = file.corrections.slice()
  corrections[index] = next
  return {version: CORRECTIONS_VERSION, corrections}
}

export const retireCorrection = (file: CorrectionsFile, id: string): CorrectionsFile =>
  transitionCorrection(file, id, 'retired')

export const flagCorrectionForReconfirmation = (file: CorrectionsFile, id: string): CorrectionsFile =>
  transitionCorrection(file, id, 'needs-reconfirmation')

export const reconfirmCorrection = (file: CorrectionsFile, id: string): CorrectionsFile =>
  transitionCorrection(file, id, 'active')

function correctionNotFound(id: string): CorrectionStoreError {
  return new CorrectionStoreError({
    code: 'CORRECTION_NOT_FOUND',
    path: 'corrections',
    message: `corrections: correction ${id} was not found`,
  })
}
