export type GuardResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly matchedFiles: readonly string[];
};
export interface PrivateLeakAdapter {
    resolvePrivateRepositoryNames: (params: {
        readonly content: string;
        readonly snapshotSha?: string;
    }) => Promise<readonly string[]>;
}
export interface PrivateLeakScanRequest {
    readonly privateNames: readonly string[];
    readonly diff: string;
    readonly override: OverrideOptions;
}
export interface OverrideOptions {
    readonly titlePrefixed: boolean;
    readonly isOperator: boolean;
}
/**
 * Pure private-repository disclosure detector. The request-time GitHub adapter
 * belongs outside this module and supplies only the authority list.
 */
export declare function checkPrivateLeak(privateNames: readonly string[], diff: string, override: OverrideOptions): GuardResult;
export declare function checkPrivateLeakWithAdapter(adapter: PrivateLeakAdapter, request: Omit<PrivateLeakScanRequest, 'privateNames'> & {
    readonly content: string;
    readonly snapshotSha?: string;
}): Promise<GuardResult>;
