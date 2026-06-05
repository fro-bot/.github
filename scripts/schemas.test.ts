import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {
  assertAllowlistFile,
  assertRenovateFile,
  assertReposFile,
  assertSocialCooldownsFile,
  isAllowlistFile,
  isDiscoveryChannel,
  isRenovateFile,
  isReposFile,
  isSocialCooldownsFile,
  SchemaValidationError,
} from './schemas.ts'

function readMetadata(filename: string): unknown {
  return parse(readFileSync(`metadata/${filename}`, 'utf8'))
}

function catchSchemaError(fn: () => void): SchemaValidationError {
  try {
    fn()
  } catch (error) {
    if (error instanceof SchemaValidationError) return error
    throw new Error(`Expected SchemaValidationError, got ${String(error)}`)
  }
  throw new Error('Expected function to throw SchemaValidationError, but it did not throw')
}

describe('schemas — real metadata files', () => {
  it('validates metadata/allowlist.yaml', () => {
    const data = readMetadata('allowlist.yaml')
    expect(isAllowlistFile(data)).toBe(true)
    expect(() => assertAllowlistFile(data)).not.toThrow()
  })

  it('validates metadata/repos.yaml', () => {
    const data = readMetadata('repos.yaml')
    expect(isReposFile(data)).toBe(true)
    expect(() => assertReposFile(data)).not.toThrow()
  })

  it('validates metadata/renovate.yaml', () => {
    const data = readMetadata('renovate.yaml')
    expect(isRenovateFile(data)).toBe(true)
    expect(() => assertRenovateFile(data)).not.toThrow()
  })

  it('validates metadata/social-cooldowns.yaml', () => {
    const data = readMetadata('social-cooldowns.yaml')
    expect(isSocialCooldownsFile(data)).toBe(true)
    expect(() => assertSocialCooldownsFile(data)).not.toThrow()
  })
})

describe('schemas — rejection cases', () => {
  it('rejects null input', () => {
    expect(isAllowlistFile(null)).toBe(false)
    expect(() => assertAllowlistFile(null)).toThrow(SchemaValidationError)
  })

  it('rejects wrong version number', () => {
    const bad = {version: 2, approved_inviters: []}
    expect(isAllowlistFile(bad)).toBe(false)
    expect(() => assertAllowlistFile(bad)).toThrow(SchemaValidationError)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toBe('allowlist.version')
  })

  it('rejects missing required field', () => {
    const bad = {version: 1}
    expect(isAllowlistFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toContain('approved_inviters')
  })

  it('rejects wrong field type in repos', () => {
    const bad = {version: 1, repos: [{name: 123, status: 'active'}]}
    expect(isReposFile(bad)).toBe(false)
    expect(() => assertReposFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid onboarding_status enum', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2025-01-01',
          onboarding_status: 'invalid',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('onboarding_status')
  })

  it('accepts lost-access onboarding_status', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'lost-access',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts pending-review onboarding_status', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending-review',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('rejects archived as an onboarding_status (not in the enum)', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'archived',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('onboarding_status')
  })

  it('accepts owned discovery_channel + populated next_survey_eligible_at', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'agent',
          added: '2026-05-05',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'owned',
          next_survey_eligible_at: '2026-05-19',
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts contrib discovery_channel', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'bfra-me',
          name: '.github',
          added: '2026-05-05',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: true,
          has_renovate: true,
          discovery_channel: 'contrib',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('rejects unknown discovery_channel value', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'partner',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('discovery_channel')
  })

  it('rejects null discovery_channel', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: null,
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('discovery_channel')
  })

  it('accepts legacy entries missing discovery_channel and next_survey_eligible_at', () => {
    // #given a legacy entry from before the cadence migration landed
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    // #when the schema validates it
    // #then it accepts the entry; downstream code defaults missing channel to 'collab'
    // and missing eligible-at to immediately-eligible until the cadence migration runs
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('rejects next_survey_eligible_at as a number', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: 42,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('next_survey_eligible_at')
  })

  it('isDiscoveryChannel accepts the three valid values', () => {
    expect(isDiscoveryChannel('collab')).toBe(true)
    expect(isDiscoveryChannel('owned')).toBe(true)
    expect(isDiscoveryChannel('contrib')).toBe(true)
  })

  it('isDiscoveryChannel rejects invalid values', () => {
    expect(isDiscoveryChannel('partner')).toBe(false)
    expect(isDiscoveryChannel('')).toBe(false)
    expect(isDiscoveryChannel(null)).toBe(false)
    expect(isDiscoveryChannel(undefined)).toBe(false)
    expect(isDiscoveryChannel(42)).toBe(false)
  })

  it('accepts entry with private: true and node_id', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'marcusrbrown',
          name: 'cart',
          added: '2026-05-05',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-05-06',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: '2026-06-08',
          private: true,
          node_id: 'R_kgDOSVJgdw',
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts entry with private: false and node_id', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'agent',
          added: '2026-05-05',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'owned',
          next_survey_eligible_at: null,
          private: false,
          node_id: 'R_kgDOPublic',
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts redacted entry shape (private: true, owner: [REDACTED], name: <node_id>)', () => {
    // #given a private entry already in its always-redacted form
    const ok = {
      version: 1,
      repos: [
        {
          owner: '[REDACTED]',
          name: 'R_kgDOSVJgdw',
          added: '2026-05-05',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-05-06',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: '2026-06-08',
          private: true,
          node_id: 'R_kgDOSVJgdw',
        },
      ],
    }
    // #when the schema validates the entry
    // #then it accepts because owner and name are still strings;
    // the schema does not enforce semantic shape
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts legacy entries missing private and node_id', () => {
    // #given a legacy entry from before the privacy migration
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('rejects null private', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          private: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('private')
  })

  it('rejects numeric private', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          private: 1,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('private')
  })

  it('rejects string private (not boolean)', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          private: 'yes',
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('private')
  })

  it('rejects null node_id', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          node_id: null,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('node_id')
  })

  it('rejects empty-string node_id', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          node_id: '',
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('node_id')
  })

  it('rejects numeric node_id', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          node_id: 12345,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('node_id')
  })

  it('#3412: accepts legacy padded base64 node_id (MDEw...==)', () => {
    // NODE_ID_PATTERN = /^[\w-]+={0,2}$/ — accepts URL-safe base64 body chars (word chars + hyphen)
    // plus optional trailing = padding; legacy MDEw... IDs pass because their body uses only A-Za-z0-9
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          node_id: 'MDEwOlJlcG9zaXRvcnk3Njg3NTEzMg==',
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('#3412: rejects node_id with owner/repo slash form (marcusrbrown/poly)', () => {
    // A slash-shaped node_id is a credential hygiene risk — the pattern must reject it
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          node_id: 'marcusrbrown/poly',
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('node_id')
  })

  it('#3412: rejects node_id containing a space (R_kg DO)', () => {
    // Spaces are not in [\w-] — must be rejected
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          node_id: 'R_kg DO',
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('node_id')
  })

  it('rejects node_id containing standard base64 + or / chars (not URL-safe)', () => {
    // NODE_ID_PATTERN = /^[\w-]+={0,2}$/ — + and / are not in [\w-] and must be rejected.
    // slash-forms and plus-forms are rejected; only URL-safe base64 body chars are accepted.
    const invalidBase64Ids = [
      'R_kgDO+bad', // + is standard base64 but not URL-safe — rejected
      'MDEw/abc', // / is standard base64 but not URL-safe — rejected
      'a=b', // mid-string padding is not trailing-only — rejected
    ]
    for (const nodeId of invalidBase64Ids) {
      const bad = {
        version: 1,
        repos: [
          {
            owner: 'fro-bot',
            name: 'test',
            added: '2026-04-17',
            onboarding_status: 'pending',
            last_survey_at: null,
            last_survey_status: null,
            has_fro_bot_workflow: false,
            has_renovate: false,
            node_id: nodeId,
          },
        ],
      }
      expect(isReposFile(bad)).toBe(false)
      const error = catchSchemaError(() => assertReposFile(bad))
      expect(error.path).toContain('node_id')
    }
  })

  it('rejects node_id containing shell metacharacters (defense-in-depth for operator copy-paste safety)', () => {
    // NODE_ID_PATTERN = /^[\w-]+={0,2}$/ — accepts URL-safe base64 body chars (word chars + hyphen)
    // plus optional trailing = padding. Shell metacharacters are rejected at parse time so they
    // can never reach the issue body's inline gh api graphql command.
    // NOTE: + and / (standard base64) are rejected; only URL-safe base64 chars are accepted.
    const shellMetaIds = ["R_kgDO'injected", 'R_kgDO`cmd`', 'R_kgDO$VAR', 'R_kgDO;evil', 'R_kgDO with space']
    for (const nodeId of shellMetaIds) {
      const bad = {
        version: 1,
        repos: [
          {
            owner: 'fro-bot',
            name: 'test',
            added: '2026-04-17',
            onboarding_status: 'pending',
            last_survey_at: null,
            last_survey_status: null,
            has_fro_bot_workflow: false,
            has_renovate: false,
            node_id: nodeId,
          },
        ],
      }
      expect(isReposFile(bad)).toBe(false)
      const error = catchSchemaError(() => assertReposFile(bad))
      expect(error.path).toContain('node_id')
    }
  })

  it('accepts node_id with valid GitHub node_id characters (alphanumeric, underscore, hyphen, and URL-safe base64)', () => {
    // NODE_ID_PATTERN = /^[\w-]+={0,2}$/ — accepts URL-safe base64 body chars (word chars + hyphen)
    // plus optional trailing = or == padding. + and / (standard base64) are rejected.
    // Legacy MDEw... IDs happen to use only A-Za-z0-9 in their body, so they still pass.
    const validIds = [
      'R_kgDOSVJgdw',
      'I_kwDOBxyz123',
      'PR_kwDO-abc_XYZ',
      'MDEwOlJlcG9zaXRvcnkxODY5MTU0', // no padding — body chars only, passes URL-safe check
      'MDEwOlJlcG9zaXRvcnkzMDg1MzMxOTg=', // = padding
      'MDEwOlJlcG9zaXRvcnk3Njg3NTEzMg==', // == padding
    ]
    for (const nodeId of validIds) {
      const ok = {
        version: 1,
        repos: [
          {
            owner: 'fro-bot',
            name: 'test',
            added: '2026-04-17',
            onboarding_status: 'pending',
            last_survey_at: null,
            last_survey_status: null,
            has_fro_bot_workflow: false,
            has_renovate: false,
            node_id: nodeId,
          },
        ],
      }
      expect(isReposFile(ok)).toBe(true)
      expect(() => assertReposFile(ok)).not.toThrow()
    }
  })

  it('rejects non-string entry in with-renovate list', () => {
    const bad = {repositories: {'with-renovate': ['valid', 42]}}
    expect(isRenovateFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertRenovateFile(bad))
    expect(error.path).toContain('with-renovate[1]')
  })

  it('rejects missing repositories key in renovate file', () => {
    const bad = {version: 1, repos: ['agent']}
    expect(isRenovateFile(bad)).toBe(false)
    expect(() => assertRenovateFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects non-array with-renovate in renovate file', () => {
    const bad = {repositories: {'with-renovate': 'not-an-array'}}
    expect(isRenovateFile(bad)).toBe(false)
    expect(() => assertRenovateFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid cooldown entry (missing last_broadcast_at)', () => {
    const bad = {version: 1, cooldowns: {pr_review: {repo: 'fro-bot/.github'}}}
    expect(isSocialCooldownsFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertSocialCooldownsFile(bad))
    expect(error.path).toContain('last_broadcast_at')
  })

  it('SchemaValidationError has correct shape', () => {
    const error = catchSchemaError(() => assertAllowlistFile('not an object'))
    expect(error.name).toBe('SchemaValidationError')
    expect(typeof error.path).toBe('string')
    expect(error.message).toContain(error.path)
  })
})

describe('AllowlistFile — approved_contrib_orgs + approved_contrib_repos', () => {
  it('accepts a populated allowlist with both contrib arrays', () => {
    const ok = {
      version: 1,
      approved_inviters: [{username: 'marcusrbrown', added: '2026-04-15', role: 'owner'}],
      approved_contrib_orgs: ['bfra-me'],
      approved_contrib_repos: ['some-org/foo', 'other-org/bar'],
    }
    expect(isAllowlistFile(ok)).toBe(true)
    expect(() => assertAllowlistFile(ok)).not.toThrow()
  })

  it('accepts an allowlist with empty contrib arrays', () => {
    const ok = {
      version: 1,
      approved_inviters: [],
      approved_contrib_orgs: [],
      approved_contrib_repos: [],
    }
    expect(isAllowlistFile(ok)).toBe(true)
    expect(() => assertAllowlistFile(ok)).not.toThrow()
  })

  it('accepts a legacy allowlist missing both contrib fields (backward-compat)', () => {
    // Existing metadata/allowlist.yaml predates contrib channel; loaders must accept it.
    const ok = {version: 1, approved_inviters: []}
    expect(isAllowlistFile(ok)).toBe(true)
    expect(() => assertAllowlistFile(ok)).not.toThrow()
  })

  it('rejects approved_contrib_orgs containing non-string entry', () => {
    const bad = {
      version: 1,
      approved_inviters: [],
      approved_contrib_orgs: ['bfra-me', 42],
      approved_contrib_repos: [],
    }
    expect(isAllowlistFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toContain('approved_contrib_orgs')
  })

  it('rejects approved_contrib_repos containing entry without owner/repo slash', () => {
    const bad = {
      version: 1,
      approved_inviters: [],
      approved_contrib_orgs: [],
      approved_contrib_repos: ['just-a-name'],
    }
    expect(isAllowlistFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toContain('approved_contrib_repos')
  })

  it('rejects approved_contrib_orgs that is not an array', () => {
    const bad = {
      version: 1,
      approved_inviters: [],
      approved_contrib_orgs: 'bfra-me',
      approved_contrib_repos: [],
    }
    expect(isAllowlistFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toContain('approved_contrib_orgs')
  })
})
