/**
 * Tests for capture-learnings-privacy.ts
 *
 * Structure:
 * - Pure function tests: `learningBodyHasPrivateLeak`
 * - Disk loader tests: `loadPrivateTokensFromDisk` (injectable readFile, fail-closed)
 * - Secret detection tests: `logDiffHasSecret` (block patterns)
 * - Secret redaction tests: `redactLogDiffSecrets` (redact patterns → '[REDACTED]')
 *
 * Privacy mutation-proof: each privacy test includes a "without the gate" assertion
 * that proves removing the check would let the content through.
 */

import {describe, expect, it} from 'vitest'

import {
  learningBodyHasPrivateLeak,
  loadPrivateTokensFromDisk,
  logDiffHasSecret,
  redactLogDiffSecrets,
} from './capture-learnings-privacy.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a private token set from a synthetic owner/name for test isolation. */
function makePrivateTokens(nameWithOwner: string): Set<string> {
  return buildPrivateTokenSet([nameWithOwner])
}

// ---------------------------------------------------------------------------
// learningBodyHasPrivateLeak — pure function tests
// ---------------------------------------------------------------------------

describe('learningBodyHasPrivateLeak', () => {
  describe('detection', () => {
    it('detects the owner/name form (slash-separated)', () => {
      // #given a body containing the owner/name form of a private repo
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This PR touched testowner/secret-repo in the changes.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the owner--name form (double-dash)', () => {
      // #given a body containing the double-dash form
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'See testowner--secret-repo for context.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects mixed-case occurrences (case-insensitive scan)', () => {
      // #given a body with the token in mixed case
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'The repo TESTOWNER/SECRET-REPO was involved.'

      // #when scanning
      // #then the leak is detected (body is lowercased before scan)
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the slug form produced by computeRepoSlug', () => {
      // #given a body containing the wiki-slug form
      const tokens = makePrivateTokens('testowner/secret-repo')
      // The slug form is testowner--secret-repo (same as double-dash for simple names)
      const body = 'Wiki page at testowner--secret-repo.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })
  })

  describe('clean body', () => {
    it('returns false for a body with no private tokens', () => {
      // #given a body with no private identifiers
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This is a clean learning about CI improvements.'

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(false)
    })

    it('returns false when the private token set is empty', () => {
      // #given an empty token set (e.g. no private repos in metadata)
      const body = 'Any body content here.'

      // #when scanning with an empty token set
      // #then no leak is detected (vacuously safe)
      expect(learningBodyHasPrivateLeak(body, new Set())).toBe(false)
    })

    it('returns false for an empty body', () => {
      // #given an empty body
      const tokens = makePrivateTokens('testowner/secret-repo')

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak('', tokens)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// loadPrivateTokensFromDisk — fail-closed behavior (injectable readFile)
// ---------------------------------------------------------------------------

describe('loadPrivateTokensFromDisk', () => {
  it('throws when metadata/repos.yaml cannot be read (fail-closed)', async () => {
    // #given the file cannot be read
    const readFileFn = async () => {
      throw new Error('ENOENT: no such file or directory')
    }

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when metadata/repos.yaml cannot be parsed (fail-closed)', async () => {
    // #given the file contains invalid YAML
    const readFileFn = async () => '{ invalid yaml: [unclosed'

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when repos.yaml has unexpected shape (not a record)', async () => {
    // #given the file parses to a non-record (e.g. a list)
    const readFileFn = async () => '- item1\n- item2\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: metadata/repos.yaml has unexpected shape',
    )
  })

  it('throws when repos.yaml is missing the repos array', async () => {
    // #given the file has no repos key
    const readFileFn = async () => 'other_key: value\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: metadata/repos.yaml missing repos array',
    )
  })

  it('returns a token set built from private non-redacted repos', async () => {
    // #given a valid repos.yaml with one private repo and one public repo
    const yaml = `
repos:
  - owner: testowner
    name: secret-repo
    private: true
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then tokens include forms of the private repo but not the public one
    expect(tokens.has('testowner/secret-repo')).toBe(true)
    expect(tokens.has('testowner--secret-repo')).toBe(true)
    // Public repo should not be in the token set
    expect(tokens.has('testowner/public-repo')).toBe(false)
  })

  it('skips redacted entries', async () => {
    // #given a repos.yaml with a redacted private entry
    const yaml = `
repos:
  - owner: '[REDACTED]'
    name: '[REDACTED]'
    private: true
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty (redacted entries are skipped)
    expect(tokens.size).toBe(0)
  })

  it('returns an empty set when there are no private repos', async () => {
    // #given a repos.yaml with only public repos
    const yaml = `
repos:
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty
    expect(tokens.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// logDiffHasSecret — block patterns (pure function tests)
// ---------------------------------------------------------------------------

describe('logDiffHasSecret', () => {
  describe('happy path — clean content', () => {
    it('returns false for a clean diff/log string with no secrets', () => {
      // #given a clean diff with no secret shapes
      const body = `
diff --git a/scripts/foo.ts b/scripts/foo.ts
index abc..def 100644
--- a/scripts/foo.ts
+++ b/scripts/foo.ts
@@ -1,3 +1,4 @@
 const x = 1
+const y = 2
`
      // #when scanning
      // #then no secret is detected
      expect(logDiffHasSecret(body)).toBe(false)
    })

    it('returns false for an empty body', () => {
      // #given an empty body
      // #when scanning
      // #then no secret is detected
      expect(logDiffHasSecret('')).toBe(false)
    })
  })

  describe('block — GitHub PAT (ghp_ / gho_ / ghu_ / ghs_ / ghr_)', () => {
    it('detects a ghp_ PAT with 36+ chars', () => {
      // #given a body containing a GitHub PAT (ghp_ prefix, 36 chars)
      // Using an obviously-fake token — 'A'.repeat(36) is not a real credential
      const body = `CI log: token=ghp_${'A'.repeat(36)} was used`

      // #when scanning
      // #then the secret is detected and must block
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a gho_ OAuth token', () => {
      const body = `Authorization: gho_${'B'.repeat(36)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a ghu_ user-to-server token', () => {
      const body = `token: ghu_${'C'.repeat(36)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a ghs_ server-to-server token', () => {
      const body = `ghs_${'D'.repeat(36)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a ghr_ refresh token', () => {
      const body = `refresh_token=ghr_${'E'.repeat(36)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })
  })

  describe('block — fine-grained PAT (github_pat_)', () => {
    it('detects a github_pat_ fine-grained PAT with 82 chars', () => {
      // #given a body containing a fine-grained PAT (github_pat_ prefix, 82 chars)
      // Using an obviously-fake token — 'F'.repeat(82) is not a real credential
      const body = `export GITHUB_TOKEN=github_pat_${'F'.repeat(82)}`

      // #when scanning
      // #then the secret is detected and must block
      expect(logDiffHasSecret(body)).toBe(true)
    })
  })

  describe('block — private key blocks', () => {
    it('detects a BEGIN RSA PRIVATE KEY block', () => {
      // #given a body containing a private key header
      const body = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`

      // #when scanning
      // #then the secret is detected and must block
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a BEGIN PRIVATE KEY block (PKCS#8)', () => {
      const body = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...\n-----END PRIVATE KEY-----`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a BEGIN EC PRIVATE KEY block', () => {
      const body = `-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIBkg...\n-----END EC PRIVATE KEY-----`
      expect(logDiffHasSecret(body)).toBe(true)
    })
  })

  describe('block — credential-bearing connection strings', () => {
    it('detects a postgres:// connection string with credentials', () => {
      // #given a body containing a postgres connection string with user:pass
      const body = `DATABASE_URL=postgres://user:pass@host.example.com/db`

      // #when scanning
      // #then the secret is detected and must block
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a postgresql:// connection string', () => {
      const body = `postgresql://admin:s3cr3t@db.internal:5432/mydb`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a mysql:// connection string with credentials', () => {
      const body = `mysql://root:password@localhost/schema`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a redis:// connection string with credentials', () => {
      const body = `redis://user:token@cache.example.com:6379`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a mongodb:// connection string with credentials', () => {
      const body = `mongodb://admin:pass@mongo.example.com:27017/db`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects an amqps:// connection string with credentials', () => {
      const body = `amqps://user:pass@rabbit.example.com/vhost`
      expect(logDiffHasSecret(body)).toBe(true)
    })
  })

  describe('block — cloud/LLM key shapes', () => {
    it('detects an AWS AKIA access key', () => {
      // #given a body containing an AWS access key ID
      const body = `AWS_ACCESS_KEY_ID=AKIA${'0'.repeat(16)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects an AWS ASIA temporary access key', () => {
      const body = `ASIA${'1'.repeat(16)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects an OpenAI sk- key', () => {
      // #given a body containing an OpenAI API key shape
      const body = `OPENAI_API_KEY=sk-${'a'.repeat(20)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects an Anthropic sk-ant- key', () => {
      // #given a body containing an Anthropic API key shape
      const body = `ANTHROPIC_API_KEY=sk-ant-${'b'.repeat(20)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a Slack xoxb- bot token', () => {
      const body = `SLACK_TOKEN=xoxb-${'1'.repeat(10)}-${'2'.repeat(10)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })

    it('detects a Slack xoxp- user token', () => {
      const body = `xoxp-${'a'.repeat(10)}-${'b'.repeat(10)}`
      expect(logDiffHasSecret(body)).toBe(true)
    })
  })

  describe('block negative — no over-blocking on innocent content', () => {
    it('returns false for a body with the word "github" but no secret shape', () => {
      // #given a body mentioning github without any secret pattern
      const body = 'This PR was merged on github.com/fro-bot/.github'
      expect(logDiffHasSecret(body)).toBe(false)
    })

    it('returns false for a body with the word "token" but no secret shape', () => {
      // #given a body mentioning token without any secret pattern
      const body = 'The token field is documented in the README.'
      expect(logDiffHasSecret(body)).toBe(false)
    })

    it('returns false for a body with "sk-" but too short to match', () => {
      // #given a body with sk- prefix but only 5 chars (below the 20-char minimum)
      const body = 'sk-abc'
      expect(logDiffHasSecret(body)).toBe(false)
    })

    it('returns false for a postgres URL without credentials (no user:pass@)', () => {
      // #given a postgres URL with no embedded credentials
      const body = 'See the postgres docs at https://www.postgresql.org/docs/'
      expect(logDiffHasSecret(body)).toBe(false)
    })
  })

  describe('MUTATION PROOF — gate is load-bearing', () => {
    it('detects a ghp_ PAT — flipping this function to always return false would fail this test', () => {
      // MUTATION PROOF: this test asserts logDiffHasSecret returns true for a real secret shape.
      // If logDiffHasSecret were short-circuited to `return false`, this assertion would fail,
      // proving the gate is load-bearing. The real cross-module mutation proof comes in Unit 2
      // where the gate is wired into the digest; here we prove the function itself is non-trivial.
      //
      // Using an obviously-fake token — 'A'.repeat(36) is not a real credential.
      const bodyWithGhpToken = `CI output: ghp_${'A'.repeat(36)} was found in env`

      // #when scanning a body that contains a real secret shape
      const result = logDiffHasSecret(bodyWithGhpToken)

      // #then the gate must return true — disabling it (return false) makes this fail
      expect(result).toBe(true)

      // Complementary: a clean body must return false (proves the function is not always-true either)
      const cleanBody = 'No secrets here, just a normal CI log line.'
      expect(logDiffHasSecret(cleanBody)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// redactLogDiffSecrets — redact patterns (pure function tests)
// ---------------------------------------------------------------------------

describe('redactLogDiffSecrets', () => {
  describe('happy path — clean content unchanged', () => {
    it('returns a clean diff/log string unchanged', () => {
      // #given a clean body with no redact-class patterns
      const body = 'diff --git a/foo.ts b/foo.ts\n+const x = 1\n'

      // #when redacting
      // #then the body is returned unchanged
      expect(redactLogDiffSecrets(body)).toBe(body)
    })

    it('returns an empty body unchanged', () => {
      // #given an empty body
      // #when redacting
      // #then empty string is returned
      expect(redactLogDiffSecrets('')).toBe('')
    })
  })

  describe('redact — Bearer tokens', () => {
    it('redacts a Bearer token while preserving surrounding prose', () => {
      // #given a body with a Bearer token in a non-Authorization context (e.g. a log line)
      // Note: when Bearer appears inside an Authorization header, the Authorization pattern
      // fires and redacts the whole header value. This test uses a standalone Bearer token.
      const body = 'Request sent with Bearer abcdefgh12345 to the API'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the token value is gone and surrounding prose is preserved
      expect(result).not.toContain('abcdefgh12345')
      expect(result).toContain('Bearer [REDACTED]')
      expect(result).toContain('Request sent with')
      expect(result).toContain('to the API')
    })

    it('does not over-redact short placeholder values (min 8 chars)', () => {
      // #given a body with a very short token-like value (below the 8-char minimum)
      const body = 'token=x is a placeholder'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the short value is NOT redacted (below minimum length)
      expect(result).toBe(body)
    })
  })

  describe('redact — Authorization headers', () => {
    it('redacts an Authorization header value while preserving surrounding prose', () => {
      // #given a body with an Authorization header
      const body = 'Log line: Authorization: Basic dXNlcjpwYXNz and then more text'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the credential value is gone and surrounding prose is preserved
      expect(result).not.toContain('dXNlcjpwYXNz')
      expect(result).toContain('Authorization: [REDACTED]')
      expect(result).toContain('Log line:')
      expect(result).toContain('and then more text')
    })
  })

  describe('redact — file paths', () => {
    it('redacts a /Users/ path while preserving surrounding prose', () => {
      // #given a body with a /Users/ path
      const body = 'Error reading /Users/alice/project/config.json in the build'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the path is gone and surrounding prose is preserved
      expect(result).not.toContain('/Users/alice')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('Error reading')
      expect(result).toContain('in the build')
    })

    it('redacts a /home/ path while preserving surrounding prose', () => {
      // #given a body with a /home/ path
      const body = 'Config loaded from /home/runner/work/repo/.env successfully'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the path is gone and surrounding prose is preserved
      expect(result).not.toContain('/home/runner')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('Config loaded from')
      expect(result).toContain('successfully')
    })

    it('redacts a /var/log/ path while preserving surrounding prose', () => {
      // #given a body with a /var/log/ path
      const body = 'See /var/log/nginx/access.log for details'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the path is gone and surrounding prose is preserved
      expect(result).not.toContain('/var/log/nginx')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('See')
      expect(result).toContain('for details')
    })

    it('redacts a /etc/ path while preserving surrounding prose', () => {
      // #given a body with an /etc/ path
      const body = 'Reading /etc/hosts for hostname resolution'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the path is gone and surrounding prose is preserved
      expect(result).not.toContain('/etc/hosts')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('Reading')
      expect(result).toContain('for hostname resolution')
    })
  })

  describe('redact — internal hostnames', () => {
    it('redacts a *.fro.bot hostname while preserving surrounding prose', () => {
      // #given a body with an internal fro.bot hostname
      const body = 'Request to gateway.fro.bot failed with 503'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the hostname is gone and surrounding prose is preserved
      expect(result).not.toContain('gateway.fro.bot')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('Request to')
      expect(result).toContain('failed with 503')
    })

    it('redacts a *.bfra.me hostname while preserving surrounding prose', () => {
      // #given a body with an internal bfra.me hostname
      const body = 'Connecting to api.bfra.me for metadata sync'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the hostname is gone and surrounding prose is preserved
      expect(result).not.toContain('api.bfra.me')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('Connecting to')
      expect(result).toContain('for metadata sync')
    })
  })

  describe('edge cases', () => {
    it('does not over-redact a short token=x placeholder', () => {
      // #given a body with a very short value that looks like a token assignment
      const body = 'token=x is a placeholder value'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the short value is NOT redacted (no pattern matches it)
      expect(result).toBe(body)
    })

    it('applies multiple redactions in a single body', () => {
      // #given a body with both a Bearer token and an internal hostname
      const body = 'Bearer abcdefgh12345 called api.bfra.me/endpoint'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then both are redacted
      expect(result).not.toContain('abcdefgh12345')
      expect(result).not.toContain('api.bfra.me')
      expect(result).toContain('Bearer [REDACTED]')
      expect(result).toContain('[REDACTED]')
      expect(result).toContain('called')
      expect(result).toContain('/endpoint')
    })

    it('Bearer token with base64 chars (+/) is fully redacted', () => {
      // #given a standalone Bearer token containing + and / (valid base64 chars)
      // Note: using a standalone Bearer (not inside an Authorization header) so the
      // Bearer pattern fires rather than the Authorization header pattern
      const body = 'Request sent with Bearer abc+def/ghi12345 to the API'

      // #when redacting
      const result = redactLogDiffSecrets(body)

      // #then the token value is fully redacted (no tail survives)
      expect(result).not.toContain('abc+def/ghi12345')
      expect(result).toContain('Bearer [REDACTED]')
    })
  })
})

// ---------------------------------------------------------------------------
// SECRET_BLOCK_PATTERNS — Google API key, GitLab PAT, JWT, generic creds
// ---------------------------------------------------------------------------

describe('logDiffHasSecret — additional block patterns', () => {
  it('detects a Google API key (AIza prefix + 35 chars)', () => {
    // #given a body containing a Google API key shape
    // Using an obviously-fake key — 'A'.repeat(35) is not a real credential
    const body = `GOOGLE_API_KEY=AIza${'A'.repeat(35)}`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('does NOT block a short AIza string (below 35 chars)', () => {
    // #given a body with AIza prefix but too short
    const body = `AIza${'A'.repeat(10)}`

    // #when scanning
    // #then not blocked (too short)
    expect(logDiffHasSecret(body)).toBe(false)
  })

  it('detects a GitLab PAT (glpat- prefix + 20+ chars)', () => {
    // #given a body containing a GitLab PAT shape
    // Using an obviously-fake token — 'B'.repeat(20) is not a real credential
    const body = `GITLAB_TOKEN=glpat-${'B'.repeat(20)}`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('detects a JWT (header.payload.signature format)', () => {
    // #given a body containing a JWT shape
    // Using obviously-fake base64url segments
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    const payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0'
    const sig = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const body = `token=${header}.${payload}.${sig}`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('detects a generic password assignment (password= with 16+ char value)', () => {
    // #given a body containing a password assignment
    const body = `password=supersecretvalue123456`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('detects a generic secret assignment (secret: with 16+ char value)', () => {
    // #given a body containing a secret assignment
    const body = `secret: mysupersecretvalue123`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('detects a generic api_key assignment (api_key= with 16+ char value)', () => {
    // #given a body containing an api_key assignment
    const body = `api_key=abcdefghijklmnop`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('detects a generic access_token assignment (access_token= with 16+ char value)', () => {
    // #given a body containing an access_token assignment
    const body = `access_token=abcdefghijklmnopqrst`

    // #when scanning
    // #then the secret is detected and must block
    expect(logDiffHasSecret(body)).toBe(true)
  })

  it('does NOT block a short generic credential value (below 16 chars)', () => {
    // #given a body with a short password value (below the 16-char minimum)
    const body = `password=short`

    // #when scanning
    // #then not blocked (too short to be a real credential)
    expect(logDiffHasSecret(body)).toBe(false)
  })
})
