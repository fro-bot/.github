export interface RenderingPolicyFinding {
  readonly kind: 'unsafe-html'
  readonly path: string
  readonly message: string
}

export interface RenderingPolicyValidationParams {
  readonly path: string
  readonly content: string
}

const UNSAFE_TAG_PATTERN =
  /<\/?\s*(?:script|iframe|object|embed|applet|base|form|input|button|textarea|select|option|meta|link|style|template|svg|math)\b[^>]*>/iu
const EVENT_HANDLER_PATTERN = /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu
const UNSAFE_URI_PATTERN =
  /\s+(?:href|src|srcset|action|formaction|xlink:href|poster|background|cite)\s*=\s*(?:"\s*|')?(?:javascript|vbscript|data):/iu

/** Return save-side findings for HTML that the render policy will strip. */
export function validateRenderingPolicy(params: RenderingPolicyValidationParams): readonly RenderingPolicyFinding[] {
  const findings: RenderingPolicyFinding[] = []
  const renderableMarkdown = maskCodeContent(params.content)
  if (
    UNSAFE_TAG_PATTERN.test(renderableMarkdown) ||
    EVENT_HANDLER_PATTERN.test(renderableMarkdown) ||
    UNSAFE_URI_PATTERN.test(renderableMarkdown)
  ) {
    findings.push({
      kind: 'unsafe-html',
      path: params.path,
      message: 'Content contains HTML that is not permitted by the wiki rendering policy.',
    })
  }
  return findings
}

export function maskCodeContent(content: string): string {
  const lines = content.split('\n')
  let fence: {character: string; length: number} | undefined

  const masked = lines.map(line => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker !== undefined) {
      const character = marker[0] ?? ''
      if (fence === undefined) {
        fence = {character, length: marker.length}
      } else if (fence.character === character && marker.length >= fence.length) {
        fence = undefined
      }
      return line.replaceAll(/[^\n]/gu, ' ')
    }

    return fence === undefined ? line : line.replaceAll(/[^\n]/gu, ' ')
  })

  return masked.join('\n').replaceAll(/`[^`\n]*`/gu, value => value.replaceAll(/[^\n]/gu, ' '))
}

/** Mask fenced/indented code and blockquotes so prose-only checks ignore quoted material. */
export function maskNonProseContent(content: string): string {
  let inBlockquote = false
  return maskCodeContent(content)
    .split('\n')
    .map(line => {
      const isBlockquoteLine = /^ {0,3}>/u.test(line)
      if (isBlockquoteLine) inBlockquote = true
      else if (line.trim() === '') inBlockquote = false

      const isIndentedCode = /^(?: {4}|\t)/u.test(line)
      if (isBlockquoteLine || inBlockquote || isIndentedCode) return line.replaceAll(/[^\n]/gu, ' ')
      return line
    })
    .join('\n')
}
