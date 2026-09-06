export interface MarkdownLink {
    readonly target: string;
    readonly line: number;
    readonly resolvedPath: string;
    readonly exists: boolean;
}
export interface MarkdownLinkResolverOptions {
    readonly rootDir?: string;
    readonly files?: Readonly<Record<string, string>>;
}
/** Resolve live relative markdown links and report whether their targets exist. */
export declare function resolveMarkdownLinks(content: string, containingFile: string, options?: MarkdownLinkResolverOptions): MarkdownLink[];
