const UNSAFE_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "applet",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
  "style",
  "template",
  "svg",
  "math"
])

const URL_PROPERTIES = new Set(["href", "src", "srcset", "action", "formaction", "xlinkhref", "poster", "background", "cite"])

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUnsafeUrl(value) {
  if (typeof value !== "string") return false
  const decoded = decodeCharacterReferences(value)
  const normalized = decoded.replaceAll(/[\u0000-\u0020\u007f]/gu, "").toLowerCase()
  return /^(?:javascript|vbscript|data):/u.test(normalized)
}

function decodeCharacterReferences(value) {
  return value
    .replaceAll(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (match, hexadecimal, decimal) => {
      const digits = hexadecimal ?? decimal
      const radix = hexadecimal === undefined ? 10 : 16
      const codePoint = Number.parseInt(digits, radix)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    })
    .replaceAll(/&(colon|newline|tab);?/giu, (_match, name) => {
      if (name.toLowerCase() === "colon") return ":"
      return name.toLowerCase() === "tab" ? "\t" : "\n"
    })
}

function sanitizeProperties(properties) {
  if (!isRecord(properties)) return {}

  const safe = {}
  for (const [name, value] of Object.entries(properties)) {
    const lowerName = name.toLowerCase()
    if (lowerName.startsWith("on") || lowerName === "style") continue
    if (URL_PROPERTIES.has(lowerName) && (isUnsafeUrl(value) || (Array.isArray(value) && value.some(isUnsafeUrl)))) continue
    safe[name] = value
  }
  return safe
}

function sanitizeChildren(parent) {
  if (!isRecord(parent) || !Array.isArray(parent.children)) return

  const safeChildren = []
  for (const child of parent.children) {
    if (!isRecord(child)) continue
    if (child.type === "raw") continue
    if (child.type === "element") {
      if (typeof child.tagName === "string" && UNSAFE_ELEMENTS.has(child.tagName.toLowerCase())) continue
      child.properties = sanitizeProperties(child.properties)
    }
    sanitizeChildren(child)
    safeChildren.push(child)
  }
  parent.children = safeChildren
}

export function sanitizeHtmlTree(root) {
  sanitizeChildren(root)
  return root
}

export function sanitizeHtml() {
  return tree => {
    sanitizeHtmlTree(tree)
  }
}

export default function RenderingPolicy() {
  return {
    name: "RenderingPolicy",
    htmlPlugins() {
      return [sanitizeHtml]
    }
  }
}
