/**
 * Pure planning for the operator rename: a wiki snapshot plus a proven repository rename in,
 * the next set of file changes (or a typed block reason) out.
 *
 * Nothing here reads a network, a clock or a branch. The caller proves the rename from GitHub,
 * supplies the snapshot and the timestamp, and decides how to commit the result. A block carries a
 * fixed reason code and nothing else, so it can never echo a private identifier.
 *
 * Decisions (see docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md):
 * - The page moves; it gets no alias (`validateWikilinks` ignores aliases, so an alias would not
 *   keep a link valid, and a later repo reusing the old name would make it ambiguous).
 * - A page without `node_id` is adopted only when its structured `sources` contain the exact old
 *   repository URL. The body is never consulted.
 * - `log.md` history and `knowledge/wiki/README.md` are never rewritten.
 */
import { type FrontmatterDocument } from './frontmatter.js';
/**
 * One file operation in a planned rename. The op says why the path is touched, so the committing
 * writer can hold each operation to its own rule (e.g. `create-page` must not overwrite anything).
 */
export type PageChange = {
    readonly op: 'create-page' | 'edit-page' | 'repair-links' | 'write-index' | 'append-log';
    readonly path: string;
    readonly content: string;
} | {
    readonly op: 'delete-page';
    readonly path: string;
};
/** Why a rename cannot be planned. Fixed codes only: a block never carries a name, ID or path. */
export type RepoPageMoveBlockReason = 'invalid-name' | 'slug-collision' | 'private-name-collision' | 'unparseable-page' | 'old-page-not-attributed' | 'both-pages-present' | 'page-ahead-of-row' | 'target-page-occupied' | 'invalid-index' | 'invalid-wikilinks';
export interface RepoRowRef {
    readonly owner: string;
    readonly name: string;
}
export interface PlanRepoPageMoveParams {
    /** Path → content for `knowledge/index.md`, `knowledge/log.md` and the pages under `knowledge/wiki/`. */
    readonly files: Readonly<Record<string, string>>;
    /** The row's node ID: the identity the page must carry (or be attributable to). */
    readonly nodeId: string;
    readonly owner: string;
    readonly oldName: string;
    readonly newName: string;
    /** The name the `metadata/repos.yaml` row holds right now: `oldName` before the rename, `newName` after. */
    readonly rowName: string;
    /** Every other row, public or redacted, so the move cannot land on or orphan another repo's slug. */
    readonly otherRows: readonly RepoRowRef[];
    /**
     * Private-name tokens (from `buildPrivateTokenSet`); compared case-insensitively. Optional: a
     * caller that cannot read private repository names omits it, and the promotion privacy gate
     * remains the check on a public rename onto a private name.
     */
    readonly privateTokens?: ReadonlySet<string>;
    readonly timestamp: Date;
}
export type RepoPageMovePlan = {
    readonly outcome: 'blocked';
    readonly reason: RepoPageMoveBlockReason;
}
/** The wiki already reflects the rename for this row. */
 | {
    readonly outcome: 'already-applied';
}
/** There is no page for the old name, so only the metadata row changes. */
 | {
    readonly outcome: 'metadata-only';
} | {
    readonly outcome: 'moved' | 'edited-in-place';
    readonly changes: readonly PageChange[];
};
/** Apply a change set to a file map, returning a new map. */
export declare function applyPageChanges(files: Readonly<Record<string, string>>, changes: readonly PageChange[]): Record<string, string>;
export declare function planRepoPageMove(params: PlanRepoPageMoveParams): RepoPageMovePlan;
/**
 * Whether a parsed repo page belongs to `nodeId`: a page with a `node_id` belongs to exactly that
 * node; one without belongs to whoever its structured `sources` name (`oldUrl`, exact). The body is
 * never consulted. This is the one ownership rule: the planner, the writer's path policy and the
 * CLI's already-applied check all call it, so they cannot disagree about a page.
 */
export declare function attributesPageTo(document: FrontmatterDocument, nodeId: string, oldUrl: string): boolean;
/**
 * Whether a parsed repo page already carries everything a rename gives it: this node's ID, the new
 * title and the new repository URL in its structured sources. The planner's already-applied decision
 * for a same-slug rename, and the writer's early already-applied check, both use this one definition.
 */
export declare function pageReflectsRename(document: FrontmatterDocument, nodeId: string, owner: string, newName: string): boolean;
/** The `url` of every structured `sources` entry of a parsed page. */
export declare function pageSourceUrls(document: FrontmatterDocument): string[];
