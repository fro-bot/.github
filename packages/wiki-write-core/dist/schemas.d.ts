/**
 * Runtime type guards for metadata files. Schemas documented in metadata/README.md.
 *
 * - `is<Name>` — returns boolean
 * - `assert<Name>` — throws SchemaValidationError with a path to the bad field
 *
 * Call `assert<Name>` on the result of `parse(yamlText)` before operating on the data.
 */
export interface AllowlistFile {
    version: 1;
    approved_inviters: ApprovedInviter[];
    /**
     * Operator-curated list of GitHub org logins. Repos under these orgs that contain
     * `.github/workflows/fro-bot.yaml` are eligible to surface via the `contrib` channel.
     * Optional during the rollout window; loaders treat missing as `[]` for backward compat.
     */
    approved_contrib_orgs?: string[];
    /**
     * Operator-curated list of `owner/name` strings. Each named repo is probed for
     * `.github/workflows/fro-bot.yaml` and surfaced via the `contrib` channel when present.
     * Optional during the rollout window; loaders treat missing as `[]` for backward compat.
     */
    approved_contrib_repos?: string[];
}
export interface ApprovedInviter {
    username: string;
    added: string;
    role: string;
}
export interface ReposFile {
    version: 1;
    repos: RepoEntry[];
}
export interface RepoEntry {
    owner: string;
    name: string;
    added: string;
    onboarding_status: OnboardingStatus;
    last_survey_at: string | null;
    last_survey_status: SurveyStatus | null;
    has_fro_bot_workflow: boolean;
    has_renovate: boolean;
    /**
     * Which channel surfaced this entry. Sticky after first write — reconcile never auto-rewrites it.
     * Operators can re-classify by editing `metadata/repos.yaml` on the `data` branch directly.
     *
     * Optional during the rollout window: legacy entries without a channel are treated as `'collab'`
     * by default. The cadence migration path will tighten this to required after `data` is migrated.
     */
    discovery_channel?: DiscoveryChannel;
    /**
     * ISO date (YYYY-MM-DD) at which this entry becomes eligible for re-survey, or `null` for
     * entries that have never been surveyed (treat as immediately eligible).
     *
     * Optional during the rollout window: legacy entries without an eligibility date are treated
     * as immediately eligible. The cadence migration path will tighten this to required after
     * `data` is migrated.
     */
    next_survey_eligible_at?: string | null;
    /**
     * Whether this repo is private. Authoritative input for the privacy posture: when `true`,
     * autonomous mutators write the entry in always-redacted form (`owner: '[REDACTED]'`,
     * `name: <node_id>`) so canonical identifiers never reach `main`. Populated by reconcile's
     * 5-state probe; preserved across transient/malformed responses (sticky).
     *
     * Optional during the rollout window: legacy entries from before the privacy migration
     * have no value, and downstream code defaults absent to "treat as private until probe
     * confirms otherwise" (fail-safe). Tightened to required after `data` is migrated.
     */
    private?: boolean;
    /**
     * GitHub GraphQL global node ID (e.g. `R_kgDO...`). Stable across owner/name renames and
     * doubles as the redacted name when `private: true`. Populated by reconcile's probe.
     *
     * Optional during the rollout window for the same reason as `private`. Tightened later.
     */
    node_id?: string;
    /**
     * Stable numeric GitHub REST `repository.id`. The format-independent denylist anchor for
     * redacted entries: unlike `node_id`, this value does not change when GitHub migrates its
     * node_id format (legacy base64 → next-gen `R_…`). Populated by reconcile's field probe.
     *
     * Like `node_id`, this promotes to main with the entry but must NEVER be embedded in a
     * rendered/logged public surface (issue text, commit message, log line). Optional: legacy
     * and public entries need not carry it; a redacted entry without `database_id` remains
     * protected by the primary `node_id` guard.
     */
    database_id?: number;
    /**
     * Optional operator-declared cross-repo receipt contract capability. When set to
     * `'coordination-issue-v1'`, this target is receipt-accountable for A3 cross-repo dispatch:
     * the coordinator treats a missing accepted receipt as non-terminal rather than best-effort.
     * This is an administrative routing gate written only through the `data`-branch sole-writer
     * path (see the `repos.yaml` sole-writer rule above) — it is not a prompt-delivered value or
     * a target self-report, and it does not prove the target will actually comply at runtime.
     * Absent means legacy/best-effort: dispatchable, but a missing receipt is never read as
     * evidence the worker did not run or as `completed`. See `metadata/README.md` for the full
     * authority boundary.
     */
    cross_repo_receipts?: string;
}
export type OnboardingStatus = 'pending' | 'onboarded' | 'failed' | 'lost-access' | 'pending-review';
export type SurveyStatus = 'success' | 'failure';
export type DiscoveryChannel = 'collab' | 'owned' | 'contrib';
export interface RenovateFile {
    repositories: {
        'with-renovate': string[];
    };
}
export interface SocialCooldownsFile {
    version: 1;
    cooldowns: Record<string, SocialCooldownEntry>;
}
export interface SocialCooldownEntry {
    last_broadcast_at: string;
    repo?: string;
}
export declare class SchemaValidationError extends Error {
    readonly path: string;
    constructor(path: string, message: string);
}
export declare function isAllowlistFile(value: unknown): value is AllowlistFile;
export declare function assertAllowlistFile(value: unknown, path?: string): asserts value is AllowlistFile;
export declare function isReposFile(value: unknown): value is ReposFile;
export declare function assertReposFile(value: unknown, path?: string): asserts value is ReposFile;
export declare function isDiscoveryChannel(value: unknown): value is DiscoveryChannel;
export declare function isRenovateFile(value: unknown): value is RenovateFile;
export declare function assertRenovateFile(value: unknown, path?: string): asserts value is RenovateFile;
export declare function isSocialCooldownsFile(value: unknown): value is SocialCooldownsFile;
export declare function assertSocialCooldownsFile(value: unknown, path?: string): asserts value is SocialCooldownsFile;
