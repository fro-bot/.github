export type WikiLintFindingKind = 'broken-wikilink' | 'broken-markdown-link' | 'orphan-page' | 'index-drift' | 'missing-frontmatter' | 'invalid-frontmatter' | 'stale-claim' | 'missing-cross-reference' | 'knowledge-gap' | 'correction-eroded' | 'correction-needs-reconfirmation';
export type WikiLintCorrectionLifecycle = 'active' | 'needs-reconfirmation';
export type WikiLintCorrectionAction = 'restore-span' | 'reconfirm-correction';
export interface WikiLintCorrectionRecovery {
    readonly lifecycle: WikiLintCorrectionLifecycle;
    readonly action: WikiLintCorrectionAction;
}
export interface WikiLintFinding {
    readonly kind: WikiLintFindingKind;
    readonly path: string;
    readonly message: string;
    readonly target?: string;
    /** Structured recovery data for correction findings; absent for other finding kinds. */
    readonly recovery?: WikiLintCorrectionRecovery;
}
export interface WikiLintResult {
    readonly ok: boolean;
    readonly deterministicFindings: readonly WikiLintFinding[];
    readonly advisoryFindings: readonly WikiLintFinding[];
    readonly summary: string;
    readonly report: string;
    readonly pages: readonly WikiLintPageInfo[];
}
export interface WikiLintPageInfo {
    readonly path: string;
    readonly updated: string | null;
}
export interface WikiLintJsonFinding {
    readonly kind: WikiLintFindingKind;
    readonly severity: 'deterministic' | 'advisory';
    readonly path: string;
    readonly target: string | null;
    readonly message: string;
    readonly fingerprint: string;
    readonly recovery?: WikiLintCorrectionRecovery;
}
export interface WikiLintFreshnessEntry {
    readonly path: string;
    readonly updated: string | null;
    readonly days_stale: number | null;
    readonly stale_threshold_days: number;
}
export interface WikiLintCounts {
    readonly findings_total: number;
    readonly findings_deterministic: number;
    readonly findings_advisory: number;
    readonly pages_scanned: number;
    readonly pages_stale: number;
}
export interface WikiLintJsonReport {
    readonly schema_version: number;
    readonly fingerprint_version: number;
    readonly status: 'clean' | 'findings' | 'execution-failure';
    readonly scan_complete: boolean;
    readonly snapshot_sha: string | null;
    readonly generated_at: string;
    readonly failure_class: 'snapshot-restore' | 'lint-execution' | null;
    readonly repair_eligible: boolean;
    readonly findings: readonly WikiLintJsonFinding[];
    readonly freshness: readonly WikiLintFreshnessEntry[];
    readonly counts: WikiLintCounts;
}
export interface BuildWikiLintJsonReportParams {
    readonly result: WikiLintResult;
    readonly status: 'clean' | 'findings' | 'execution-failure';
    readonly scanComplete: boolean;
    readonly snapshotSha: string | null;
    readonly generatedAt: string;
    readonly failureClass: 'snapshot-restore' | 'lint-execution' | null;
}
export interface LintWikiSnapshotParams {
    readonly files: Record<string, string>;
    readonly now?: Date;
}
export interface WriteWikiLintOutputsParams {
    readonly result: WikiLintResult;
    readonly reportPath: string;
    readonly jsonPath?: string;
    readonly snapshotSha?: string | null;
    readonly generatedAt?: string;
    readonly githubStepSummaryPath?: string;
    readonly githubOutputPath?: string;
}
export interface WriteWikiLintOutputsResult {
    readonly status: 'clean' | 'findings';
    readonly reportPath: string;
    readonly jsonPath: string;
}
export interface WriteWikiLintFailureOutputsParams {
    readonly message: string;
    readonly reportPath: string;
    readonly jsonPath?: string;
    readonly failureClass?: 'snapshot-restore' | 'lint-execution';
    readonly githubStepSummaryPath?: string;
    readonly githubOutputPath?: string;
}
export interface WriteWikiLintFailureOutputsResult {
    readonly status: 'execution-failure';
    readonly reportPath: string;
    readonly jsonPath: string;
}
export interface RunWikiLintParams {
    readonly rootDir?: string;
    readonly reportPath: string;
    readonly jsonPath?: string;
    readonly snapshotSha?: string | null;
    readonly githubStepSummaryPath?: string;
    readonly githubOutputPath?: string;
    readonly now?: Date;
}
export interface RunWikiLintResult extends WriteWikiLintOutputsResult {
    readonly result: WikiLintResult;
}
export declare function buildWikiLintJsonReport(params: BuildWikiLintJsonReportParams): WikiLintJsonReport;
export declare function lintWikiSnapshot(params: LintWikiSnapshotParams): WikiLintResult;
export declare function writeWikiLintOutputs(params: WriteWikiLintOutputsParams): Promise<WriteWikiLintOutputsResult>;
export declare function writeWikiLintFailureOutputs(params: WriteWikiLintFailureOutputsParams): Promise<WriteWikiLintFailureOutputsResult>;
export declare function runWikiLint(params: RunWikiLintParams): Promise<RunWikiLintResult>;
export { splitFrontmatter } from './wiki-utils.js';
export declare function runWikiLintCli(): Promise<void>;
