import { Octokit } from '@octokit/rest';
import { type GuardResult, type PrivateLeakAdapter, type PrivateLeakScanRequest } from './private-leak.js';
export type GitHubPrivateLeakAdapterErrorCode = 'MISSING_TOKEN' | 'METADATA_UNAVAILABLE' | 'METADATA_INVALID' | 'RESOLUTION_FAILED' | 'OCTOKIT_INIT_FAILED';
export declare class PrivateLeakAdapterError extends Error {
    readonly code: GitHubPrivateLeakAdapterErrorCode;
    readonly remediation: string;
    constructor(params: {
        code: GitHubPrivateLeakAdapterErrorCode;
        message: string;
        remediation: string;
    });
}
/**
 * The subset of Octokit used by the request-time privacy adapter. Tests can
 * provide this small surface without constructing the full SDK object.
 */
export interface GitHubPrivateLeakClient {
    readonly rest: {
        readonly repos: {
            readonly getContent: Octokit['rest']['repos']['getContent'];
        };
    };
    readonly graphql: Octokit['graphql'];
}
export interface GitHubPrivateLeakAdapterParams {
    readonly token?: string;
    readonly octokit?: GitHubPrivateLeakClient;
    readonly owner?: string;
    readonly repo?: string;
    readonly branch?: string;
}
export interface GitHubPrivateLeakScanRequest extends Omit<PrivateLeakScanRequest, 'privateNames'> {
    readonly content: string;
    readonly snapshotSha?: string;
    readonly token?: string;
    readonly octokit?: GitHubPrivateLeakClient;
    readonly adapter?: PrivateLeakAdapter;
}
/**
 * Build a request-time adapter backed by the authoritative data-branch
 * metadata. The adapter never reads workflow event state or process env.
 */
export declare function createGitHubPrivateLeakAdapter(params?: GitHubPrivateLeakAdapterParams): Promise<PrivateLeakAdapter>;
/**
 * Scan candidate content with the GitHub-backed privacy adapter. Callers may
 * reuse an adapter to cache resolution by the metadata blob SHA, or provide
 * only a token and the request content.
 */
export declare function checkPrivateLeakWithGitHub(request: GitHubPrivateLeakScanRequest): Promise<GuardResult>;
