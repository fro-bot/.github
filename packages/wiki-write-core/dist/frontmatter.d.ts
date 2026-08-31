export interface FrontmatterDocument {
    readonly values: Record<string, unknown>;
    readonly body: string;
}
/** Parse a validated wiki document while retaining its raw body. */
export declare function parseFrontmatterDocument(content: string): FrontmatterDocument;
/** Reconstruct a wiki document with system-owned frontmatter and normalized body. */
export declare function renderFrontmatterDocument(values: Record<string, unknown>, body: string): string;
export declare function reconstructFrontmatter(existingContent: string, body: string, preservedFields?: readonly string[]): string;
