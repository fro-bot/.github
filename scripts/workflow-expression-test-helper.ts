/**
 * Minimal GitHub Actions expression evaluator, just enough for the workflow `if:` predicates under test:
 * `||`, `&&`, `!`, `==`, `!=`, parentheses, string and integer literals, dotted property access (missing
 * paths are null), and the endsWith/contains/fromJSON functions. `||`/`&&` return operand
 * values like Actions does; string comparison is case-insensitive.
 */
const truthy = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '' && value !== false && value !== 0
const lower = (value: unknown): unknown => (typeof value === 'string' ? value.toLowerCase() : value)

function callFunction(name: string, args: unknown[]): unknown {
  const [first, second] = args
  switch (name) {
    case 'endsWith':
      return String(first).toLowerCase().endsWith(String(second).toLowerCase())
    case 'contains':
      return Array.isArray(first)
        ? first.some(item => lower(item) === lower(second))
        : String(first).toLowerCase().includes(String(second).toLowerCase())
    case 'fromJSON':
      return JSON.parse(String(first)) as unknown
    default:
      throw new Error(`unsupported function ${name}`)
  }
}

const TOKEN = /\s*('(?:[^']|'')*'|\d+|[a-z_][\w.-]*|\|\||&&|!=|==|[!(),])/iy

/** Split an expression into tokens; any character that starts no token is an error, never skipped. */
function tokenize(source: string): string[] {
  const tokens: string[] = []
  let position = 0
  for (;;) {
    TOKEN.lastIndex = position
    const match = TOKEN.exec(source)
    if (match === null) {
      const rest = source.slice(position)
      if (rest.trim() !== '')
        throw new Error(`unexpected character at ${position + rest.length - rest.trimStart().length}`)
      return tokens
    }
    tokens.push(match[1] ?? '')
    position = TOKEN.lastIndex
  }
}

// Recursive-descent parser; methods (not closures) so the mutually recursive productions satisfy no-use-before-define.
class ExpressionEvaluator {
  private readonly tokens: string[]
  private readonly context: unknown
  private position = 0

  constructor(source: string, context: unknown) {
    this.tokens = tokenize(source)
    this.context = context
  }

  evaluate(): boolean {
    const result = this.parseOr()
    if (this.position !== this.tokens.length) throw new Error(`unparsed tokens from ${this.position}`)
    return truthy(result)
  }

  private peek(): string | undefined {
    return this.tokens[this.position]
  }

  private take(expected?: string): string {
    const token = this.tokens[this.position++]
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`expected ${expected ?? 'token'} at ${this.position}, got ${String(token)}`)
    }
    return token
  }

  private lookup(path: string): unknown {
    let current: unknown = this.context
    for (const key of path.split('.')) {
      if (typeof current !== 'object' || current === null) return null
      current = (current as Record<string, unknown>)[key] ?? null
    }
    return current
  }

  private parseOr(): unknown {
    let left = this.parseAnd()
    while (this.peek() === '||') {
      this.take()
      const right = this.parseAnd()
      left = truthy(left) ? left : right
    }
    return left
  }

  private parseAnd(): unknown {
    let left = this.parseEquality()
    while (this.peek() === '&&') {
      this.take()
      const right = this.parseEquality()
      left = truthy(left) ? right : left
    }
    return left
  }

  private parseEquality(): unknown {
    const left = this.parseUnary()
    if (this.peek() === '==' || this.peek() === '!=') {
      const operator = this.take()
      const equal = lower(left) === lower(this.parseUnary())
      return operator === '==' ? equal : !equal
    }
    return left
  }

  private parseUnary(): unknown {
    if (this.peek() === '!') {
      this.take()
      return !truthy(this.parseUnary())
    }
    return this.parsePrimary()
  }

  private parsePrimary(): unknown {
    const token = this.take()
    if (token === '(') {
      const value = this.parseOr()
      this.take(')')
      return value
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'")
    if (token === 'null') return null
    if (/^\d+$/.test(token)) return Number(token)
    if (this.peek() === '(') {
      this.take('(')
      const args: unknown[] = []
      while (this.peek() !== ')') {
        args.push(this.parseOr())
        if (this.peek() === ',') this.take()
      }
      this.take(')')
      return callFunction(token, args)
    }
    return this.lookup(token)
  }
}

export function evaluateExpression(source: string, context: unknown): boolean {
  return new ExpressionEvaluator(source, context).evaluate()
}
