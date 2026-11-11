/**
 * Bun is pinned in two files: `mise.toml` (`[tools] bun`) and `package.json` (`packageManager`). The shared
 * setup action installs mise, then installs Bun from `package.json` (`bun-version-file`), so a local
 * `mise install` and CI would run different Bun versions if the pins drifted. This test reads the real files
 * and fails when they disagree.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse as parseYaml} from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function parseMiseBunPin(text: string): string {
  let inTools = false
  for (const line of text.split('\n')) {
    const section = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line)
    if (section !== null) {
      inTools = section[1] === 'tools'
      continue
    }
    const pin = inTools ? /^\s*bun\s*=\s*"(\d+\.\d+\.\d+)"\s*(?:#.*)?$/u.exec(line) : null
    if (pin !== null) return pin[1] as string
  }
  throw new Error('mise.toml: no `bun = "<major>.<minor>.<patch>"` entry under [tools]')
}

function parsePackageManagerBunPin(text: string): string {
  const manifest: unknown = JSON.parse(text)
  const packageManager =
    typeof manifest === 'object' && manifest !== null && 'packageManager' in manifest
      ? manifest.packageManager
      : undefined
  const pin = typeof packageManager === 'string' ? /^bun@(\d+\.\d+\.\d+)$/u.exec(packageManager) : null
  if (pin === null) throw new Error('package.json: packageManager must be `bun@<major>.<minor>.<patch>`')
  return pin[1] as string
}

describe('bun pin parity', () => {
  it('pins the same Bun version in mise.toml and package.json', () => {
    const mise = parseMiseBunPin(readRepoFile('mise.toml'))
    const packageManager = parsePackageManagerBunPin(readRepoFile('package.json'))

    expect(mise).toBe(packageManager)
  })

  it('installs Bun in the setup action from package.json', () => {
    const action: unknown = parseYaml(readRepoFile('.github/actions/setup/action.yaml'))
    const steps =
      typeof action === 'object' && action !== null && 'runs' in action
        ? (action.runs as {steps?: {uses?: string; with?: Record<string, unknown>}[]}).steps
        : undefined
    const setupBun = steps?.find(step => step.uses?.startsWith('oven-sh/setup-bun@') === true)

    expect(setupBun?.with?.['bun-version-file']).toBe('package.json')
  })

  describe('parsers', () => {
    it('reads the bun entry under [tools] only', () => {
      expect(parseMiseBunPin('[env]\nbun = "9.9.9"\n\n[tools]\nnode = "24.22.0"\nbun = "1.4.3" # pinned\n')).toBe(
        '1.4.3',
      )
    })

    it('rejects a mise.toml without a bun pin under [tools]', () => {
      expect(() => parseMiseBunPin('[tools]\nnode = "24.22.0"\n')).toThrow('no `bun =')
      expect(() => parseMiseBunPin('[env]\nbun = "1.4.3"\n')).toThrow('no `bun =')
      expect(() => parseMiseBunPin('[tools]\nbun = "latest"\n')).toThrow('no `bun =')
    })

    it('reads the bun version from packageManager', () => {
      expect(parsePackageManagerBunPin('{"packageManager": "bun@1.4.3"}')).toBe('1.4.3')
    })

    it('rejects a missing or non-bun packageManager', () => {
      expect(() => parsePackageManagerBunPin('{}')).toThrow('packageManager must be')
      expect(() => parsePackageManagerBunPin('{"packageManager": "pnpm@11.28.0"}')).toThrow('packageManager must be')
      expect(() => parsePackageManagerBunPin('{"packageManager": "bun@1.4"}')).toThrow('packageManager must be')
    })
  })
})
