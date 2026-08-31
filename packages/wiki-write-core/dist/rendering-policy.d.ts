export interface RenderingPolicyFinding {
    readonly kind: 'unsafe-html';
    readonly path: string;
    readonly message: string;
}
export interface RenderingPolicyValidationParams {
    readonly path: string;
    readonly content: string;
}
/** Return save-side findings for HTML that the render policy will strip. */
export declare function validateRenderingPolicy(params: RenderingPolicyValidationParams): readonly RenderingPolicyFinding[];
export declare function maskCodeContent(content: string): string;
/**
 * Mask fenced/indented code and blockquotes so prose-only checks ignore quoted material.
 * Block structure is read from the original lines because inline-code masking can create
 * leading spaces. List tracking intentionally covers ordinary nested list content; a
 * blank line ends that bounded list context rather than attempting full CommonMark parsing.
 */
export declare function maskNonProseContent(content: string): string;
