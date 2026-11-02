/**
 * The connection-string and JWT block shapes and the internal-hostname redactions run on untrusted text of
 * any size, so they must cost time linear in its length. This file pins that, and pins that the linear
 * forms decide exactly as the regexes they replaced: the old patterns are kept here as the reference, and
 * seeded random bodies are run through both.
 */

import {describe, expect, it} from 'vitest'
import {
  hasCredentialedConnectionString,
  hasJwt,
  logDiffHasSecret,
  redactInternalHostnames,
  redactLogDiffSecrets,
} from './capture-learnings-privacy.ts'

// ─── The reference: the patterns as they were before the scanners ───

const OLD_CONNECTION = /(?:postgres|postgresql|mysql|redis|mongodb|amqps?):\/\/[^\s:]+:[^\s@]+@[^\s/]+/
const OLD_JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/
const OLD_FRO_BOT_HOST = /[a-z0-9-]+\.fro\.bot\b/g
const OLD_BFRA_ME_HOST = /[a-z0-9-]+\.bfra\.me\b/g

const OLD_OTHER_BLOCK_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{36,255}/,
  /github_pat_\w{82}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,
  /sk-ant-\w{20,}/,
  /sk-[A-Za-z0-9-]{20,}/,
  /xox[bpars]-[\w-]{10,}/,
  /AIza[\w-]{35}/,
  /glpat-[\w-]{20,}/,
  /(?:password|passwd|secret|api[._-]?key|auth[._-]?token|access[._-]?token)["']?\s*[=:]\s*["']?[^\s"']{16,}/i,
]

const OLD_OTHER_REDACT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/Bearer\s+[\w\-.=+/]{8,}/g, 'Bearer [REDACTED]'],
  [/Authorization:\s*(?:\S+\s+\S{4,}|\S{8,})/g, 'Authorization: [REDACTED]'],
  [
    /(?:\/home\/[\w.-]+|\/Users\/[\w.-]+|C:\\Users\\[\w.-]+|~\/\.[a-z]+|\/var\/log\/[\w./-]*|\/etc\/[a-z]+)/g,
    '[REDACTED]',
  ],
]

function oldLogDiffHasSecret(body: string): boolean {
  return OLD_OTHER_BLOCK_PATTERNS.some(pattern => pattern.test(body)) || OLD_CONNECTION.test(body) || OLD_JWT.test(body)
}

function oldRedactLogDiffSecrets(body: string): string {
  let result = body
  for (const [pattern, replacement] of OLD_OTHER_REDACT_PATTERNS) result = result.replaceAll(pattern, replacement)
  return result.replaceAll(OLD_FRO_BOT_HOST, '[REDACTED]').replaceAll(OLD_BFRA_ME_HOST, '[REDACTED]')
}

// ─── Explicit cases: each is also checked against the reference, so the table states what the old regex did ───

describe('hasCredentialedConnectionString', () => {
  it.each([
    ['a postgres URL with credentials', 'postgres://user:pass@host', true],
    ['a postgresql URL', 'postgresql://admin:s3cr3t@db.internal:5432/mydb', true],
    ['an amqps URL', 'amqps://u:p@h', true],
    ['a scheme glued to a word, which has no boundary rule', 'xmysql://u:p@h', true],
    ['a password with colon and slash in it', 'redis://u:p:w/x@h', true],
    ['an @ inside the user part', 'mysql://u@x:p@h', true],
    ['a second scheme that succeeds after a first that fails', 'mysql://nocolon redis://u:p@h', true],
    ['an opening that starts inside the previous one', 'mysql://mysql://u:p@h', true],
    ['a host that starts with a colon', 'redis://u:p@:6379', true],
    ['no scheme match: one slash', 'mysql:/u:p@h', false],
    ['no scheme match: http', 'http://u:p@h', false],
    ['no scheme match: capitalised', 'Mysql://u:p@h', false],
    ['no scheme match: an unlisted scheme', 'redi://u:p@h', false],
    ['an empty user', 'mysql://:p@h', false],
    ['an empty password', 'mysql://u:@h', false],
    ['no @', 'mysql://u:p', false],
    ['no colon', 'mysql://u@h', false],
    ['whitespace in the password', 'mysql://u:p w@h', false],
    ['whitespace in the user', 'mysql://u v:p@h', false],
    ['an empty host at the end', 'mysql://u:p@', false],
    ['a host that starts with a slash', 'mysql://u:p@/db', false],
    ['a host that starts with a space', 'mysql://u:p@ h', false],
    ['a host that starts with a no-break space, which is whitespace', 'mysql://u:p@\u00A0h', false],
    ['a line separator inside the password', 'mysql://u:p\u2028w@h', false],
    ['an @ directly after the colon, then another', 'mysql://u:@h:p@h2', false],
    ['a second @ after the host', 'mysql://u:p@x@y', true],
    ['a URL without credentials', 'See https://www.postgresql.org/docs/', false],
    ['nothing', '', false],
  ] as const)('%s', (_name, body, expected) => {
    expect(OLD_CONNECTION.test(body)).toBe(expected)
    expect(hasCredentialedConnectionString(body)).toBe(expected)
  })
})

describe('hasJwt', () => {
  it.each([
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', true],
    ['a JWT glued to a word', 'xeyJa.eyJb.c', true],
    ['dashes and underscores in every run', 'eyJ-.eyJ_._', true],
    ['an empty first run, then a real JWT', 'eyJ.eyJa.eyJb.c', true],
    ['a JWT after a failed opening in the same run', 'eyJeyJa.eyJb.c', true],
    ['an empty first run', 'eyJ.eyJ.eyJ', false],
    ['an empty second run', 'eyJa.eyJ.c', false],
    ['an empty third run', 'eyJa.eyJb.', false],
    ['no third run', 'eyJa.eyJb', false],
    ['a space for the first dot', 'eyJa eyJb.c', false],
    ['two dots', 'eyJa..eyJb.c', false],
    ['a third run of a non-token character', 'eyJa.eyJb.=', false],
    ['a capitalised prefix', 'EYJa.eyJb.c', false],
    ['nothing', '', false],
  ] as const)('%s', (_name, body, expected) => {
    expect(OLD_JWT.test(body)).toBe(expected)
    expect(hasJwt(body)).toBe(expected)
  })
})

describe('redactInternalHostnames', () => {
  it.each([
    ['.fro.bot', 'Request to gateway.fro.bot failed', 'Request to [REDACTED] failed'],
    ['.bfra.me', 'Connecting to api.bfra.me for sync', 'Connecting to [REDACTED] for sync'],
    ['.fro.bot', 'a.fro.bot-b.fro.bot', '[REDACTED][REDACTED]'],
    ['.fro.bot', 'x.fro.bot.fro.bot', '[REDACTED].fro.bot'],
    ['.fro.bot', 'bot.fro.bot.fro.bot', '[REDACTED].fro.bot'],
    ['.fro.bot', '-.fro.bot', '[REDACTED]'],
    ['.fro.bot', '0a9-z.fro.bot/path', '[REDACTED]/path'],
    ['.fro.bot', 'GATEway.fro.bot', 'GATE[REDACTED]'],
    ['.fro.bot', 'GATEWAY.fro.bot', 'GATEWAY.fro.bot'],
    ['.fro.bot', '.fro.bot', '.fro.bot'],
    ['.fro.bot', 'x.fro.botx', 'x.fro.botx'],
    ['.fro.bot', 'x.fro.bot_', 'x.fro.bot_'],
    ['.fro.bot', 'x.fro.bot9', 'x.fro.bot9'],
    ['.fro.bot', 'x.fro.bot', '[REDACTED]'],
    ['.fro.bot', 'é.fro.bot', 'é.fro.bot'],
    ['.fro.bot', 'xé.fro.bot', 'xé.fro.bot'],
    ['.fro.bot', 'x.fro.boté', '[REDACTED]é'],
    ['.fro.bot', 'a.bfra.me', 'a.bfra.me'],
    ['.fro.bot', '', ''],
  ] as const)('%s: %j', (suffix, body, expected) => {
    const reference = suffix === '.fro.bot' ? OLD_FRO_BOT_HOST : OLD_BFRA_ME_HOST
    expect(body.replaceAll(reference, '[REDACTED]')).toBe(expected)
    expect(redactInternalHostnames(body, suffix)).toBe(expected)
  })

  it('redacts both hostnames in one pass of redactLogDiffSecrets, after the other redactions', () => {
    const body = 'GET api.bfra.me via gateway.fro.bot with Bearer abcdefgh1234 at /home/someone/x'
    expect(redactLogDiffSecrets(body)).toBe(oldRedactLogDiffSecrets(body))
    expect(redactLogDiffSecrets(body)).toBe('GET [REDACTED] via [REDACTED] with Bearer [REDACTED] at [REDACTED]/x')
  })
})

// ─── A deterministic differential against the reference ───

/** mulberry32: a small seeded generator, so a failure names a reproducible seed and index. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

type Tokens = readonly (readonly [string, number])[]

function drawBodies(tokens: Tokens, seed: number, count: number, maxTokens: number): string[] {
  const total = tokens.reduce((sum, [, weight]) => sum + weight, 0)
  const random = seeded(seed)
  const bodies: string[] = []
  for (let index = 0; index < count; index++) {
    let body = ''
    for (let remaining = 1 + Math.floor(random() * maxTokens); remaining > 0; remaining--) {
      let roll = random() * total
      for (const [token, weight] of tokens) {
        roll -= weight
        if (roll < 0) {
          body += token
          break
        }
      }
    }
    bodies.push(body)
  }
  return bodies
}

const CONNECTION_TOKENS: Tokens = [
  ['postgres://', 6],
  ['postgresql://', 4],
  ['mysql://', 6],
  ['redis://', 4],
  ['mongodb://', 4],
  ['amqp://', 6],
  ['amqps://', 4],
  ['mysql:/', 1],
  ['amqp:', 1],
  ['http://', 3],
  ['Mysql://', 1],
  [':', 10],
  ['@', 10],
  ['!', 6],
  ['/', 5],
  ['.', 3],
  ['://', 3],
  ['u', 6],
  ['pw', 6],
  ['a1', 3],
  ['host', 4],
  [' ', 4],
  ['\n', 2],
  ['\t', 1],
  ['\u00A0', 1],
  ['\u2028', 1],
]

const JWT_TOKENS: Tokens = [
  ['eyJ', 14],
  ['.', 10],
  ['.eyJ', 6],
  ['eyJhbGciOiJIUzI1NiJ9', 3],
  ['eyJa.eyJb.c', 3],
  ['a', 6],
  ['Zz9', 4],
  ['-', 4],
  ['_', 3],
  ['=', 2],
  ['!', 1],
  ['é', 1],
  [' ', 2],
  ['\n', 1],
]

const HOST_TOKENS: Tokens = [
  ['.fro.bot', 12],
  ['.bfra.me', 12],
  ['a', 8],
  ['bc9', 4],
  ['-', 6],
  ['.', 5],
  ['_', 3],
  ['bot', 3],
  ['me', 2],
  ['fro', 3],
  ['x', 3],
  ['A', 2],
  ['0', 2],
  ['.fro.botx', 2],
  [' ', 3],
  ['/', 2],
  ['\n', 1],
  ['é', 1],
]

const MIXED_TOKENS: Tokens = [
  ...CONNECTION_TOKENS,
  ...JWT_TOKENS,
  ...HOST_TOKENS,
  ['ghp_', 2],
  ['AKIA', 2],
  ['sk-', 2],
  ['password=', 2],
  ['Bearer ', 3],
  ['Authorization: ', 3],
  ['/home/user', 2],
  ['xoxb-', 1],
  ['0123456789abcdef', 3],
]

const SEEDS = [20_261_102, 4087, 50] as const
const BODIES_PER_SEED = 20_000

function share(count: number, total: number): number {
  return count / total
}

describe('the scanners decide exactly as the regexes they replaced', () => {
  it('connection strings: 60,000 seeded bodies', () => {
    let matches = 0
    let total = 0
    for (const seed of SEEDS) {
      for (const [index, body] of drawBodies(CONNECTION_TOKENS, seed, BODIES_PER_SEED, 14).entries()) {
        const expected = OLD_CONNECTION.test(body)
        if (hasCredentialedConnectionString(body) !== expected) {
          expect.fail(`seed ${seed} body #${index} ${JSON.stringify(body)}: the reference says ${expected}`)
        }
        if (expected) matches += 1
        total += 1
      }
    }
    expect(total).toBe(60_000)
    expect(share(matches, total)).toBeGreaterThan(0.05)
    expect(share(matches, total)).toBeLessThan(0.7)
  })

  it('JWTs: 60,000 seeded bodies', () => {
    let matches = 0
    let total = 0
    for (const seed of SEEDS) {
      for (const [index, body] of drawBodies(JWT_TOKENS, seed, BODIES_PER_SEED, 14).entries()) {
        const expected = OLD_JWT.test(body)
        if (hasJwt(body) !== expected) {
          expect.fail(`seed ${seed} body #${index} ${JSON.stringify(body)}: the reference says ${expected}`)
        }
        if (expected) matches += 1
        total += 1
      }
    }
    expect(total).toBe(60_000)
    expect(share(matches, total)).toBeGreaterThan(0.05)
    expect(share(matches, total)).toBeLessThan(0.7)
  })

  it('hostname redaction: 60,000 seeded bodies, both suffixes', () => {
    let changed = 0
    let manyReplacements = 0
    let total = 0
    for (const seed of SEEDS) {
      for (const [index, body] of drawBodies(HOST_TOKENS, seed, BODIES_PER_SEED, 14).entries()) {
        for (const [suffix, reference] of [
          ['.fro.bot', OLD_FRO_BOT_HOST],
          ['.bfra.me', OLD_BFRA_ME_HOST],
        ] as const) {
          const expected = body.replaceAll(reference, '[REDACTED]')
          const actual = redactInternalHostnames(body, suffix)
          if (actual !== expected) {
            expect.fail(
              `seed ${seed} body #${index} ${suffix} ${JSON.stringify(body)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
            )
          }
          if (expected !== body) changed += 1
          if (expected.split('[REDACTED]').length > 2) manyReplacements += 1
          total += 1
        }
      }
    }
    expect(total).toBe(120_000)
    expect(share(changed, total)).toBeGreaterThan(0.1)
    expect(share(changed, total)).toBeLessThan(0.9)
    expect(share(manyReplacements, total)).toBeGreaterThan(0.02)
  })

  it('the public functions: 60,000 seeded mixed bodies', () => {
    let blocked = 0
    let redacted = 0
    let total = 0
    for (const seed of SEEDS) {
      for (const [index, body] of drawBodies(MIXED_TOKENS, seed, BODIES_PER_SEED, 18).entries()) {
        const expectedBlock = oldLogDiffHasSecret(body)
        if (logDiffHasSecret(body) !== expectedBlock) {
          expect.fail(
            `seed ${seed} body #${index} ${JSON.stringify(body)}: logDiffHasSecret should be ${expectedBlock}`,
          )
        }
        const expectedRedaction = oldRedactLogDiffSecrets(body)
        if (redactLogDiffSecrets(body) !== expectedRedaction) {
          expect.fail(`seed ${seed} body #${index} ${JSON.stringify(body)}: redactLogDiffSecrets differs`)
        }
        if (expectedBlock) blocked += 1
        if (expectedRedaction !== body) redacted += 1
        total += 1
      }
    }
    expect(total).toBe(60_000)
    expect(share(blocked, total)).toBeGreaterThan(0.05)
    expect(share(blocked, total)).toBeLessThan(0.9)
    expect(share(redacted, total)).toBeGreaterThan(0.2)
    expect(share(redacted, total)).toBeLessThan(0.99)
  })
})

// ─── Time: linear on the strings CodeQL reported, and on the hostname runs ───

/** The fastest of three runs: a descheduled or garbage-collected run cannot fail the bound alone. */
function elapsed(run: () => void): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = performance.now()
    run()
    fastest = Math.min(fastest, performance.now() - startedAt)
  }
  return fastest
}

describe('linear time on adversarial bodies', () => {
  const REPETITIONS = 20_000
  const BOUND_MS = 1000
  const TIMEOUT_MS = 60_000

  it(
    'a connection string opening repeated 20,000 times',
    () => {
      const body = `mysql://!:${'amqp://!:'.repeat(REPETITIONS)}`
      expect(elapsed(() => expect(logDiffHasSecret(body)).toBe(false))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a connection string opening repeated 20,000 times, ending in a credential',
    () => {
      const body = `mysql://!:${'amqp://!:'.repeat(REPETITIONS)}x@host`
      expect(elapsed(() => expect(logDiffHasSecret(body)).toBe(true))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a JWT header repeated 20,000 times',
    () => {
      const body = `eyJ${'eyJ'.repeat(REPETITIONS)}`
      expect(elapsed(() => expect(logDiffHasSecret(body)).toBe(false))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a JWT whose openings all share one long second segment',
    () => {
      const body = `${'eyJ'.repeat(REPETITIONS)}.${'eyJ'.repeat(REPETITIONS)}`
      expect(elapsed(() => expect(logDiffHasSecret(body)).toBe(false))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a hostname label of 40,000 characters with no suffix, through redactLogDiffSecrets',
    () => {
      const body = 'a'.repeat(40_000)
      expect(elapsed(() => expect(redactLogDiffSecrets(body)).toBe(body))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a hostname label of 40,000 dashes followed by a suffix that fails its boundary',
    () => {
      const body = `${'-'.repeat(40_000)}.fro.botx`
      expect(elapsed(() => expect(redactLogDiffSecrets(body)).toBe(body))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a suffix repeated 20,000 times, so every one has a label of three characters',
    () => {
      const body = '.fro.bot'.repeat(REPETITIONS)
      expect(elapsed(() => redactLogDiffSecrets(body))).toBeLessThan(BOUND_MS)
      expect(redactLogDiffSecrets(body)).toBe(oldRedactLogDiffSecrets(body))
    },
    TIMEOUT_MS,
  )
})
