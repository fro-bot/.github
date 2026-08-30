import type {WikiLintFinding} from './wiki-lint.ts'

import {readFile, writeFile} from 'node:fs/promises'
import {parse, stringify} from 'yaml'

import {normalizeCorrectionText} from './correction-text.ts'

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

/** Loose boundary shape accepted during the rollout window. Never use it past parsing. */
export interface LooseCorrectionRecord {
  readonly id: string
  readonly page_node_id: string
  readonly span: CorrectionSpan
  readonly attribution?: CorrectionAttribution
  readonly state?: CorrectionLifecycle
  readonly superseded_by?: string
  readonly reason?: string
  readonly [key: string]: unknown
}

interface CorrectionRecordBase {
  readonly id: string
  readonly page_node_id: string
  readonly span: CorrectionSpan
  /** Optional during the loose rollout phase; new writes always include it. The tight phase will require it. */
  readonly attribution?: CorrectionAttribution
}

function withoutLifecycleFields<
  T extends CorrectionRecordBase & {state?: unknown; superseded_by?: unknown; reason?: unknown},
>(record: T): CorrectionRecordBase & Record<string, unknown> {
  const copy: Record<string, unknown> = {...(record as Record<string, unknown>)}
  delete copy.state
  delete copy.superseded_by
  delete copy.reason
  return {
    ...copy,
    id: record.id,
    page_node_id: record.page_node_id,
    span: record.span,
    ...(record.attribution === undefined ? {} : {attribution: record.attribution}),
  }
}

/** Active is the default lifecycle for legacy records without a state field. */
export interface ActiveCorrectionRecord extends CorrectionRecordBase {
  readonly state: 'active'
  readonly superseded_by?: never
}

/** Compatibility member for the current loose on-disk rollout shape. */
export interface LegacyActiveCorrectionRecord extends CorrectionRecordBase {
  readonly state?: undefined
  readonly superseded_by?: never
}

export interface SupersededCorrectionRecord extends CorrectionRecordBase {
  readonly state: 'superseded'
  readonly superseded_by: string
}

export interface RetiredCorrectionRecord extends CorrectionRecordBase {
  readonly state: 'retired'
  readonly superseded_by?: never
}

export interface NeedsReconfirmationCorrectionRecord extends CorrectionRecordBase {
  readonly state: 'needs-reconfirmation'
  readonly reason: string
  readonly superseded_by?: never
}

export type CorrectionRecord =
  | ActiveCorrectionRecord
  | LegacyActiveCorrectionRecord
  | SupersededCorrectionRecord
  | RetiredCorrectionRecord
  | NeedsReconfirmationCorrectionRecord

export type StrictCorrectionRecord = Exclude<CorrectionRecord, LegacyActiveCorrectionRecord>

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

function isCorrectionRecord(value: unknown): value is CorrectionRecord {
  try {
    assertCorrectionRecord(value, 'corrections')
    return true
  } catch {
    return false
  }
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
  const loose = parseLooseCorrectionRecord(value, path)
  normalizeLooseCorrectionRecord(loose, path)
}

function assertCorrectionSpan(value: unknown, path: string): asserts value is CorrectionSpan {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (typeof value.text !== 'string' || normalizeCorrectionText(value.text) === '')
    throw invalidCorrections(`${path}.text`, 'expected text with non-empty normalized content')
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
  if (!isRecord(value)) throw invalidCorrections('corrections', 'expected object')
  if (value.version !== CORRECTIONS_VERSION)
    throw invalidCorrections('corrections.version', `expected ${CORRECTIONS_VERSION}`)
  if (!Array.isArray(value.corrections)) throw invalidCorrections('corrections.corrections', 'expected array')
  return {
    version: CORRECTIONS_VERSION,
    corrections: value.corrections.map((entry, index) =>
      normalizeLooseCorrectionRecord(
        parseLooseCorrectionRecord(entry, `corrections.corrections[${index}]`),
        `corrections.corrections[${index}]`,
      ),
    ),
  }
}

/** Explicitly convert the loose I/O shape into one lifecycle union member. */
export function normalizeLooseCorrectionRecord(record: LooseCorrectionRecord, path = 'corrections'): CorrectionRecord {
  const base = withoutLifecycleFields(record)
  if (record.state === undefined) {
    if (record.superseded_by !== undefined)
      throw invalidCorrections(`${path}.superseded_by`, 'only superseded corrections may have a target')
    return base
  }
  if (record.state === 'active') {
    if (record.superseded_by !== undefined)
      throw invalidCorrections(`${path}.superseded_by`, 'only superseded corrections may have a target')
    return {...base, state: 'active'}
  }
  if (record.state === 'retired') {
    if (record.superseded_by !== undefined)
      throw invalidCorrections(`${path}.superseded_by`, 'only superseded corrections may have a target')
    return {...base, state: 'retired'}
  }
  if (record.state === 'superseded') {
    if (record.superseded_by === undefined || record.superseded_by === '')
      throw invalidCorrections(`${path}.superseded_by`, 'superseded corrections require a target')
    return {...base, state: 'superseded', superseded_by: record.superseded_by}
  }
  if (record.reason === undefined || record.reason === '')
    throw invalidCorrections(`${path}.reason`, 'needs-reconfirmation corrections require a reason')
  if (record.superseded_by !== undefined)
    throw invalidCorrections(`${path}.superseded_by`, 'only superseded corrections may have a target')
  return {...base, state: 'needs-reconfirmation', reason: record.reason}
}

function parseLooseCorrectionRecord(value: unknown, path: string): LooseCorrectionRecord {
  if (!isRecord(value)) throw invalidCorrections(path, 'expected object')
  if (typeof value.id !== 'string' || value.id === '')
    throw invalidCorrections(`${path}.id`, 'expected non-empty string')
  if (typeof value.page_node_id !== 'string' || value.page_node_id === '')
    throw invalidCorrections(`${path}.page_node_id`, 'expected non-empty string')
  assertCorrectionSpan(value.span, `${path}.span`)
  let attribution: CorrectionAttribution | undefined
  if (value.attribution !== undefined) {
    assertCorrectionAttribution(value.attribution, `${path}.attribution`)
    attribution = value.attribution
  }
  if (value.state !== undefined && !isCorrectionLifecycle(value.state))
    throw invalidCorrections(`${path}.state`, 'expected active, superseded, retired, or needs-reconfirmation')
  if (value.superseded_by !== undefined && (typeof value.superseded_by !== 'string' || value.superseded_by === ''))
    throw invalidCorrections(`${path}.superseded_by`, 'expected non-empty string')
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason === ''))
    throw invalidCorrections(`${path}.reason`, 'expected non-empty string')
  const base = {...value, id: value.id, page_node_id: value.page_node_id, span: value.span}
  return {
    ...base,
    ...(attribution === undefined ? {} : {attribution}),
    ...(value.state === undefined ? {} : {state: value.state}),
    ...(value.superseded_by === undefined ? {} : {superseded_by: value.superseded_by}),
    ...(value.reason === undefined ? {} : {reason: value.reason}),
  }
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
  assertCorrectionSpan(input.span, 'input.span')
  assertCorrectionAttribution(input.serverDerivedAttribution, 'input.serverDerivedAttribution')
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
  reason?: string,
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
  if (state === 'active' && current.state !== 'needs-reconfirmation')
    throw new CorrectionStoreError({
      code: 'INVALID_TRANSITION',
      path: `corrections[${index}].state`,
      message: `corrections: active correction ${id} is not awaiting reconfirmation`,
    })
  const base = withoutLifecycleFields(current)
  let next: CorrectionRecord
  if (state === 'superseded') {
    if (supersededBy === undefined || supersededBy.length === 0)
      throw new CorrectionStoreError({
        code: 'INVALID_TRANSITION',
        path: `corrections[${index}].superseded_by`,
        message: 'corrections: superseded corrections require supersededBy',
      })
    next = {...base, state, superseded_by: supersededBy}
  } else if (state === 'needs-reconfirmation') {
    next = {...base, state, reason: reason ?? 'Legacy correction requires reconfirmation'}
  } else {
    next = {...base, state}
  }
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

// Preserve the historical direct corrections-module import while the implementation
// lives with wiki page traversal in corrections-survival.ts.
export {verifyCorrectionSurvival} from './corrections-survival.ts'
