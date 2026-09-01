import type { WikiLintFinding } from './wiki-lint.js';
/** System-owned sidecar state; it is deliberately outside rendered page content. */
export declare const CORRECTIONS_PATH: "knowledge/corrections.yaml";
export declare const CORRECTIONS_VERSION: 1;
export type CorrectionLifecycle = 'active' | 'superseded' | 'retired' | 'needs-reconfirmation';
/** The text span is the durable constraint consumed by the future survival check. */
export interface CorrectionSpan {
    readonly text: string;
    readonly start?: number;
    readonly end?: number;
}
/** Attribution is populated from the authenticated server session, never page input. */
export interface CorrectionAttribution {
    readonly actor: string;
    readonly recorded_at: string;
}
/** Loose boundary shape accepted during the rollout window. Never use it past parsing. */
export interface LooseCorrectionRecord {
    readonly id: string;
    readonly page_node_id: string;
    readonly span: CorrectionSpan;
    readonly attribution?: CorrectionAttribution;
    readonly state?: CorrectionLifecycle;
    readonly superseded_by?: string;
    readonly reason?: string;
    readonly [key: string]: unknown;
}
interface CorrectionRecordBase {
    readonly id: string;
    readonly page_node_id: string;
    readonly span: CorrectionSpan;
    /** Optional during the loose rollout phase; new writes always include it. The tight phase will require it. */
    readonly attribution?: CorrectionAttribution;
}
/** Active is the default lifecycle for legacy records without a state field. */
export interface ActiveCorrectionRecord extends CorrectionRecordBase {
    readonly state: 'active';
    readonly superseded_by?: never;
}
/** Compatibility member for the current loose on-disk rollout shape. */
export interface LegacyActiveCorrectionRecord extends CorrectionRecordBase {
    readonly state?: undefined;
    readonly superseded_by?: never;
}
export interface SupersededCorrectionRecord extends CorrectionRecordBase {
    readonly state: 'superseded';
    readonly superseded_by: string;
}
export interface RetiredCorrectionRecord extends CorrectionRecordBase {
    readonly state: 'retired';
    readonly superseded_by?: never;
}
export interface NeedsReconfirmationCorrectionRecord extends CorrectionRecordBase {
    readonly state: 'needs-reconfirmation';
    readonly reason: string;
    readonly superseded_by?: never;
}
export type CorrectionRecord = ActiveCorrectionRecord | LegacyActiveCorrectionRecord | SupersededCorrectionRecord | RetiredCorrectionRecord | NeedsReconfirmationCorrectionRecord;
export type StrictCorrectionRecord = Exclude<CorrectionRecord, LegacyActiveCorrectionRecord>;
export interface CorrectionsFile {
    readonly version: typeof CORRECTIONS_VERSION;
    readonly corrections: readonly CorrectionRecord[];
}
export interface RecordCorrectionInput {
    readonly id: string;
    readonly pageNodeId: string;
    readonly span: CorrectionSpan;
    /** Derived from the dashboard's authenticated operator session and forwarded to the writer; the writer never receives an operator session. */
    readonly serverDerivedAttribution: CorrectionAttribution;
    readonly supersedesId?: string;
}
export interface CorrectionsReadResult {
    readonly corrections: CorrectionsFile;
    readonly warnings: readonly string[];
}
export interface CorrectionSurvivalResult {
    readonly ok: boolean;
    readonly deterministicFindings: readonly WikiLintFinding[];
    readonly advisoryFindings: readonly WikiLintFinding[];
}
export type ReadUtf8File = (path: string, encoding: 'utf8') => Promise<string>;
export type WriteUtf8File = (path: string, content: string, encoding: 'utf8') => Promise<void>;
export type CorrectionStoreErrorCode = 'INVALID_CORRECTIONS' | 'CORRECTION_NOT_FOUND' | 'INVALID_TRANSITION' | 'READ_FAILED' | 'WRITE_FAILED';
export declare class CorrectionStoreError extends Error {
    readonly code: CorrectionStoreErrorCode;
    readonly path: string;
    constructor(params: {
        code: CorrectionStoreErrorCode;
        path: string;
        message: string;
    });
}
export declare function isCorrectionsFile(value: unknown): value is CorrectionsFile;
export declare function assertCorrectionsFile(value: unknown, path?: string): asserts value is CorrectionsFile;
export declare function parseCorrections(raw: string): CorrectionsFile;
/** Explicitly convert the loose I/O shape into one lifecycle union member. */
export declare function normalizeLooseCorrectionRecord(record: LooseCorrectionRecord, path?: string): CorrectionRecord;
export declare function serializeCorrections(value: unknown): string;
export declare function readCorrections(readFileImpl?: ReadUtf8File, warn?: (message: string) => void, path?: "knowledge/corrections.yaml"): Promise<CorrectionsReadResult>;
export declare function writeCorrections(value: unknown, writeFileImpl?: WriteUtf8File, path?: "knowledge/corrections.yaml"): Promise<void>;
export declare function recordCorrection(file: CorrectionsFile, input: RecordCorrectionInput): CorrectionsFile;
export declare function getCorrectionsForPage(file: CorrectionsFile, pageNodeId: string): CorrectionRecord[];
/** Legacy records without the optional state field remain active until explicitly transitioned. */
export declare function getCorrectionLifecycle(correction: CorrectionRecord): CorrectionLifecycle;
export declare function transitionCorrection(file: CorrectionsFile, id: string, state: CorrectionLifecycle, supersededBy?: string, reason?: string): CorrectionsFile;
export declare const retireCorrection: (file: CorrectionsFile, id: string) => CorrectionsFile;
export declare const flagCorrectionForReconfirmation: (file: CorrectionsFile, id: string) => CorrectionsFile;
export declare const reconfirmCorrection: (file: CorrectionsFile, id: string) => CorrectionsFile;
export { verifyCorrectionSurvival } from './corrections-survival.js';
