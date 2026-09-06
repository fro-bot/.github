import type { Octokit } from '@octokit/rest';
export interface DataBranchBootstrapParams {
    owner?: string;
    repo?: string;
    mainBranch?: string;
    dataBranch?: string;
    octokit?: OctokitClient;
}
export interface DataBranchBootstrapResult {
    created: boolean;
    ref: string;
    sha: string;
}
/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit;
export type DataBranchBootstrapErrorCode = 'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'MAIN_BRANCH_NOT_FOUND' | 'API_ERROR';
export declare class DataBranchBootstrapError extends Error {
    readonly code: DataBranchBootstrapErrorCode;
    readonly remediation: string;
    constructor(params: {
        code: DataBranchBootstrapErrorCode;
        message: string;
        remediation: string;
    });
}
export declare function bootstrapDataBranch(params?: DataBranchBootstrapParams): Promise<DataBranchBootstrapResult>;
export declare function runDataBranchBootstrapCli(): Promise<void>;
