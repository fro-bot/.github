import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  checkLockfileCoverage,
  checkLockfileIntegrity,
  isLocalLockEntry,
  isLocalPluginSource,
  runCli,
  type LockFile,
  type QuartzConfig,
} from './wiki-lockfile-gates.ts'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// checkLockfileCoverage — Gate A
// ---------------------------------------------------------------------------

describe('checkLockfileCoverage', () => {
  it('passes when every enabled github plugin has a matching lock entry (N==N)', () => {
    // #given a config with one enabled remote plugin and a lock with exactly one matching entry
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:quartz-community/plugin-a'}],
    }
    const lock: LockFile = {
      plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes with no errors
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails when an enabled remote plugin has no lock entry', () => {
    // #given an enabled github plugin absent from the lock
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:quartz-community/plugin-a'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming the missing plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('github:quartz-community/plugin-a'))).toBe(true)
  })

  it('fails when a lock entry is not an enabled config plugin (orphan)', () => {
    // #given a lock entry whose source is not in the enabled config plugin list
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {orphan: {source: 'github:quartz-community/ghost', commit: 'def456'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming the orphan entry
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('orphan'))).toBe(true)
  })

  it('renders a string-sourced orphan lock entry unquoted, not JSON.stringify-quoted', () => {
    // #given an orphan lock entry with a string source. Asserted with exact equality: a mutant that
    // #always renders the source via JSON.stringify (quoting it) would still satisfy a loose
    // #substring check on the orphan name, so only exact equality catches the difference between
    // #`(github:quartz-community/ghost)` and `("github:quartz-community/ghost")`
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {orphan: {source: 'github:quartz-community/ghost', commit: 'def456'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then the source appears unquoted, exactly as written
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'lock entry "orphan" (github:quartz-community/ghost) is not an enabled plugin in quartz.config.yaml',
    ])
  })

  it('fails when an object-source plugin uses a rejected subdir property, with the subdir-specific message', () => {
    // #given an enabled plugin with object source containing a subdir key. Asserted with exact
    // #equality rather than a loose substring check: the generic "rejected object-source form"
    // #message (for a remote object source with no subdir/ref) also JSON-stringifies the whole
    // #source, so it would ALSO contain the substring "subdir" here -- only exact equality actually
    // #pins that the dedicated subdir-rejection branch, not the generic fallback, produced this error
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-b', subdir: 'packages/x'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the subdir-rejection message
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source subdir: {"repo":"quartz-community/plugin-b","subdir":"packages/x"}',
    ])
  })

  it('exempts a local "./" object-form repo even when a rejected subdir key is also present', () => {
    // #given an object source whose repo is a local "./" path AND which also carries a subdir key --
    // #the local-path exemption check runs first (see the ordering comment above it), so it wins over
    // #the subdir rejection
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: './local', subdir: 'x'}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes -- the local-path exemption takes priority over the subdir rejection
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('exempts a local "./" string source from requiring a lock entry', () => {
    // #given an enabled plugin with a local relative-path string source and no lock entries
    const config: QuartzConfig = {plugins: [{enabled: true, source: './local-plugin'}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — local sources are exempt
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('exempts a local "./" object-form repo source from requiring a lock entry', () => {
    // #given an enabled plugin with an object source whose repo is a local relative path
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: './local-plugin'}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — local object-form sources are exempt
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('treats a plugin with no "enabled" key at all as enabled and requires a lock entry', () => {
    // #given a remote plugin config entry that omits the `enabled` key entirely -- only
    // #`enabled === false` is treated as disabled, so an absent key defaults to enabled
    const config: QuartzConfig = {plugins: [{source: 'github:quartz-community/plugin-a'}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails, naming the missing lock entry -- the plugin was not silently skipped
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('github:quartz-community/plugin-a'))).toBe(true)
  })

  it('does not require a lock entry for a disabled plugin', () => {
    // #given a disabled remote plugin absent from the lock
    const config: QuartzConfig = {
      plugins: [{enabled: false, source: 'github:quartz-community/disabled-plugin'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — disabled plugins are not required to be locked
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects an object-form {repo} remote source even when a differently-shaped lock entry exists for the same repo', () => {
    // #given an enabled plugin with an object source (no github: prefix on repo) and a lock entry
    // #whose source is the equivalent normalized `github:` string -- Quartz's lockfile writer never
    // #produces this shape (it stores `source` verbatim, so an object config source always produces
    // #an object lock entry), but even setting that aside, the gate compares source *strings*, so an
    // #object config source is uncoverable regardless of what shape the lock happens to contain
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-c'}}],
    }
    const lock: LockFile = {
      plugins: {'plugin-c': {source: 'github:quartz-community/plugin-c', commit: 'ghi789'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails rejecting the object-source form -- normalization/matching never happens
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('rejected object-source form'))).toBe(true)
  })

  it('does not error and requires no lock entry when an enabled plugin has no source at all', () => {
    // #given an enabled plugin whose `source` key is entirely absent (a valid QuartzConfigPlugin shape)
    const config: QuartzConfig = {plugins: [{enabled: true}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes silently — an absent source is neither remote nor local, so nothing is required
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails with a malformed-source error for an object source with no repo at all', () => {
    // #given an enabled plugin with an empty object source (no repo, no subdir — a degenerate but
    // #type-legal QuartzPluginObjectSource). Previously this fell through every check silently; now
    // #that every other object shape is handled explicitly, this must be reported rather than ignored
    const config: QuartzConfig = {plugins: [{enabled: true, source: {}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with the malformed-source error
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['enabled plugin has a malformed object source (missing or invalid "repo"): {}'])
  })

  it('fails with a malformed-source error for an object source whose name has no accompanying repo', () => {
    // #given an enabled plugin with a `name` override but no `repo` -- a plausible hand-edit mistake
    // #(the config author remembered to name the plugin but forgot the source)
    const config = {plugins: [{enabled: true, source: {name: 'x'}}]} as unknown as QuartzConfig
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with the malformed-source error
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled plugin has a malformed object source (missing or invalid "repo"): {"name":"x"}',
    ])
  })

  it('fails with a malformed-source error for an object source whose repo is a non-string', () => {
    // #given an enabled plugin whose object-source repo is a number -- not representable by
    // #QuartzPluginObjectSource's real type but reachable at runtime since config is only
    // #YAML.parse'd, never schema-validated (e.g. an unquoted YAML `repo: 123`)
    const config = {plugins: [{enabled: true, source: {repo: 123}}]} as unknown as QuartzConfig
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with the malformed-source error
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled plugin has a malformed object source (missing or invalid "repo"): {"repo":123}',
    ])
  })

  it('does not error and requires no lock entry when source is a truthy non-object (malformed YAML)', () => {
    // #given an enabled plugin whose source is a boolean (a malformed hand-edited quartz.config.yaml
    // #shape, not representable by QuartzConfigPlugin's real type but reachable at runtime since the
    // #config is only YAML.parse'd, never schema-validated) — pins the deleted `typeof source ===
    // #'object'` conjunct's equivalence: a truthy non-object source has no `.repo`, so it falls through
    // #every check with no error, same as before the conjunct was removed
    const config = {plugins: [{enabled: true, source: true}]} as unknown as QuartzConfig
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes silently — a truthy non-object source is neither remote nor local
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails with a malformed-source error for an object-source repo that is present but empty', () => {
    // #given an enabled plugin whose object-source repo is present but empty
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: ''}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with the malformed-source error -- an empty repo is neither remote nor local
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled plugin has a malformed object source (missing or invalid "repo"): {"repo":""}',
    ])
  })

  it('matches a string-form remote source via .some() even when other lock entries do not match it', () => {
    // #given one enabled string-source plugin and a lock with two entries, only one of which matches
    // #it — proves the entry lookup uses "any entry matches" (.some), not "every entry matches" (.every)
    const config: QuartzConfig = {plugins: [{enabled: true, source: 'github:quartz-community/plugin-q'}]}
    const lock: LockFile = {
      plugins: {
        'plugin-q': {source: 'github:quartz-community/plugin-q', commit: 'sha-q'},
        orphan: {source: 'github:quartz-community/unrelated', commit: 'sha-o'},
      },
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then the matching entry satisfies coverage — no "missing lock entry" error for plugin-q — but the
    // #unrelated entry is still flagged as an orphan
    expect(result.errors.some(e => e.includes('missing lock entry'))).toBe(false)
    expect(result.errors.some(e => e.includes('orphan') && e.includes('unrelated'))).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('rejects an object-form remote source and still reports unrelated lock entries as orphans, distinguished from each other', () => {
    // #given one enabled object-source plugin (rejected outright, so it never enters
    // #enabledRemoteSources) and a lock with two unrelated entries -- since the object source
    // #contributes nothing to the enabled-remote-source set, both lock entries are orphans
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-q'}}]}
    const lock: LockFile = {
      plugins: {
        other1: {source: 'github:quartz-community/other1', commit: 'sha-1'},
        other2: {source: 'github:quartz-community/other2', commit: 'sha-2'},
      },
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails rejecting the object-source config plugin, plus both unrelated lock entries as
    // #distinguishable orphans
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('rejected object-source form'))).toBe(true)
    expect(result.errors.some(e => e.includes('other1'))).toBe(true)
    expect(result.errors.some(e => e.includes('other2'))).toBe(true)
  })

  it('MUTATION-PROOF: a tampered lock with one entry removed fails coverage', () => {
    // #given two enabled remote plugins but a lock with only one of the two entries (tampered/incomplete)
    const config: QuartzConfig = {
      plugins: [
        {enabled: true, source: 'github:quartz-community/plugin-a'},
        {enabled: true, source: 'github:quartz-community/plugin-b'},
      ],
    }
    const lock: LockFile = {
      plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails — proving the gate is load-bearing and would catch a tampered lockfile
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('github:quartz-community/plugin-b'))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Issue #3859 — Gate A models `quartz/cli/plugin-data.js::parseGitSource` (what actually writes
  // quartz.lock.json), not `quartz/plugins/loader/gitLoader.ts::parsePluginSource` (the build-time
  // installer). Both verified at pinned SHA 9cf87ff1c248a8ca551093214b0fec3b31415009.
  // -------------------------------------------------------------------------

  it('fails coverage for an enabled git+https:// source with no lock entry', () => {
    // #given an enabled `git+https://` remote source absent from the lock -- one of the 3 remote
    // #forms the old `source.startsWith('github:')` bound silently exempted. It has 5 `/`-separated
    // #parts, so it can only be classified remote via the `git+` prefix check, not the bare
    // #two-part fallback -- this pins that exact branch, not just "some error mentions the source"
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'git+https://gitlab.com/org/plugin.git'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the missing-lock-entry error naming the source verbatim, not
    // #silently exempt and not misclassified as unparseable
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'missing lock entry for enabled remote plugin: git+https://gitlab.com/org/plugin.git',
    ])
  })

  it('fails coverage for an enabled bare https:// source with no lock entry', () => {
    // #given an enabled `https://` remote source absent from the lock. It has 5 `/`-separated parts,
    // #so it can only be classified remote via the `https://` prefix check, not the bare two-part
    // #fallback
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'https://gitlab.com/org/plugin.git'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the missing-lock-entry error naming the source verbatim, not
    // #silently exempt and not misclassified as unparseable
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['missing lock entry for enabled remote plugin: https://gitlab.com/org/plugin.git'])
  })

  it('fails coverage with an unparseable-source error for a bare owner/repo source, not a missing-lock-entry error', () => {
    // #given an enabled bare two-part `owner/repo` string source. `gitLoader.ts::parsePluginSource`
    // #(the build-time installer) has a bare-shorthand fallback that would treat this as GitHub, but
    // #that parser never runs during lock writes -- `plugin-data.js::parseGitSource` (what actually
    // #writes quartz.lock.json) has no such fallback and would throw "Cannot parse plugin source" on
    // #this. The gate must report the same diagnosis Quartz's lock writer would, not the installer's.
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'someorg/some-plugin'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the unparseable-source error, not a "missing lock entry" error --
    // #a bare owner/repo source cannot be lock-covered because Quartz's lock writer cannot parse it
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'unparseable plugin source (Quartz would throw "Cannot parse plugin source"): someorg/some-plugin',
    ])
  })

  it('classifies a github:-prefixed source with more than two path segments as remote via the github: prefix check alone', () => {
    // #given a `github:` source with a nested path (3 `/`-separated parts) -- pins that the
    // #`github:` prefix check alone drives classification, with no reliance on any bare two-part
    // #fallback (there is none in `parseGitSource`)
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:owner/repo/sub'}],
    }
    const lock: LockFile = {
      plugins: {p: {source: 'github:owner/repo/sub', commit: 'sha-nested'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes -- the source matches its lock entry verbatim
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('treats a github: source missing the repo segment as remote and requires a matching lock entry verbatim', () => {
    // #given `github:owner` with no `/repo` segment at all. `parseGitSource` does NOT validate the
    // #split result -- `[owner, repo] = repoPath.split('/')` leaves `repo` as `undefined`, and it
    // #proceeds to build `url: https://github.com/owner/undefined.git` rather than throwing. This
    // #gate does not replicate that URL construction (Gate A only ever compares the raw source
    // #string against the lock, never Quartz's derived clone URL) -- it just requires the literal
    // #`github:owner` string to appear as a lock entry's source, same as any other `github:` source
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:owner'}],
    }
    const lockMissing: LockFile = {plugins: {}}

    // #when checking coverage with no lock entry
    const resultMissing = checkLockfileCoverage(config, lockMissing)

    // #then it fails naming the literal source string as missing, not silently exempt and not
    // #reported as unparseable (the `github:` prefix alone is enough to classify it remote)
    expect(resultMissing.ok).toBe(false)
    expect(resultMissing.errors).toEqual(['missing lock entry for enabled remote plugin: github:owner'])

    // #given the same config but with a lock entry matching the literal source string
    const lockPresent: LockFile = {plugins: {p: {source: 'github:owner', commit: 'sha-owner'}}}

    // #when checking coverage
    const resultPresent = checkLockfileCoverage(config, lockPresent)

    // #then it passes -- exact string equality is all the gate requires
    expect(resultPresent.ok).toBe(true)
    expect(resultPresent.errors).toEqual([])
  })

  it('fails coverage with an unparseable-source error for a source Quartz itself would throw on', () => {
    // #given a source with no slash at all -- not local (no ./, ../, /, or drive-letter prefix) and
    // #not `github:`/`git+`/`https://` prefixed, so `parseGitSource` would throw "Cannot parse
    // #plugin source" on it
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'not-a-parseable-source'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the unparseable-source error, distinct from "missing lock entry" --
    // #it is reported rather than silently exempted
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'unparseable plugin source (Quartz would throw "Cannot parse plugin source"): not-a-parseable-source',
    ])
  })

  it('rejects an object source carrying a ref key outright, with the ref-specific message', () => {
    // #given an enabled object source with a `ref` key. Asserted with exact equality rather than a
    // #loose substring check: the generic "rejected object-source form" message (for a remote object
    // #source with no subdir/ref) also JSON-stringifies the whole source, so it would ALSO contain
    // #the substring "ref" here -- only exact equality actually pins that the dedicated
    // #ref-rejection branch, not the generic fallback, produced this error
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'owner/repo', ref: 'main'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with exactly the ref-rejection message
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source ref: {"repo":"owner/repo","ref":"main"}',
    ])
  })

  it('rejects a remote object source outright even when an identically-shaped object lock entry exists, and still reports it as an orphan', () => {
    // #given an enabled remote object source and a lock entry whose `source` is the identical object
    // #-- Quartz's lockfile writer stores `source` verbatim, so this lock shape is real, but the gate
    // #still must reject the config side outright: it compares source *strings*, and an object can
    // #never `===`-match a string, so a remote plugin declared as an object source is uncoverable by
    // #construction regardless of what the lock contains. Because the config side never adds this
    // #source to `enabledRemoteSources`, the lock entry is (correctly) ALSO reported as an orphan --
    // #the gate reports two independent, truthful findings rather than trying to reconcile them
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'github:owner/repo'}}],
    }
    const lock: LockFile = {
      plugins: {'owner-repo': {source: {repo: 'github:owner/repo'}, commit: 'sha-owner-repo'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with both the config-side rejection and the lock-side orphan report
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source form; declare it as a string source instead: {"repo":"github:owner/repo"}',
      'lock entry "owner-repo" ({"repo":"github:owner/repo"}) is not an enabled plugin in quartz.config.yaml',
    ])
  })

  it('rejects a git+ remote object source outright', () => {
    // #given an enabled object source whose repo is a `git+` URL -- pins that the outright rejection
    // #applies uniformly across remote repo forms, not just github:-prefixed ones
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'git+https://gitlab.com/org/plugin.git'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails, rejecting the object form regardless of the lock's contents
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source form; declare it as a string source instead: {"repo":"git+https://gitlab.com/org/plugin.git"}',
    ])
  })

  it('rejects an https:// remote object source outright', () => {
    // #given an enabled object source whose repo is a direct `https://` URL
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'https://gitlab.com/org/plugin.git'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails, rejecting the object form regardless of the lock's contents
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source form; declare it as a string source instead: {"repo":"https://gitlab.com/org/plugin.git"}',
    ])
  })

  it('rejects a bare owner/repo remote object source outright, the same as every other remote object shape', () => {
    // #given an enabled object source whose repo is a bare two-part string -- unlike the top-level
    // #string-source case, this is not about parseability; ANY non-local object repo is rejected
    // #outright before parseability of the repo string is even considered
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'owner/repo'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails, rejecting the object form
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'enabled remote plugin uses rejected object-source form; declare it as a string source instead: {"repo":"owner/repo"}',
    ])
  })

  it('regression: all four local-source forms stay exempt from lock coverage', () => {
    // #given four enabled string sources covering every local form Quartz's isLocalSource recognizes
    // #(./, ../, /, and a Windows drive letter), none present in the lock
    const config: QuartzConfig = {
      plugins: [
        {enabled: true, source: './p'},
        {enabled: true, source: '../p'},
        {enabled: true, source: '/p'},
        {enabled: true, source: String.raw`C:\p`},
      ],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes -- every local form remains exempt, unaffected by the stricter remote classification
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('names an orphan lock entry with an object source without interpolating [object Object]', () => {
    // #given a lock entry whose `source` is an object -- Quartz's lockfile writer stores object
    // #config sources verbatim, and this object source has no matching enabled config plugin (config
    // #never declares remote plugins as objects, since those are now rejected outright), so it must
    // #be reported as an orphan without crashing or interpolating the useless "[object Object]"
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {orphan: {source: {repo: 'github:owner/repo'}, commit: 'sha-orphan'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming the orphan, with the object source rendered as JSON, not "[object Object]"
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'lock entry "orphan" ({"repo":"github:owner/repo"}) is not an enabled plugin in quartz.config.yaml',
    ])
  })

  it('does not report a lock entry with a local source as an orphan', () => {
    // #given a lock entry for a local plugin (a local `source`, and the `commit: "local"` sentinel
    // #Quartz's lockfile writer uses for local sources) with no corresponding entry in
    // #`enabledRemoteSources` -- local plugins are deliberately exempted on the config side, so the
    // #lock-side orphan check must not flag them. The exemption is keyed on `source`, not `commit`
    // #(see the next test for why that distinction matters)
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {'local-plugin': {source: './local-plugin', commit: 'local'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes -- a local lock entry is never an orphan, regardless of config contents
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('SECURITY: does not let a remote-source lock entry bypass the orphan check merely by claiming commit: "local"', () => {
    // #given a lock entry whose `source` is REMOTE (`github:evil/x`) but whose `commit` field is the
    // #hand-writable string "local" -- `commit` is a value the lockfile itself controls and cannot be
    // #trusted to gate an exemption. If the exemption keyed on `entry.commit === 'local'` (as an
    // #earlier version of this gate did), this forged entry would silently bypass the orphan check
    // #entirely, alongside a genuine unrelated remote plugin that IS covered
    const config: QuartzConfig = {plugins: [{enabled: true, source: 'github:good/x'}]}
    const lock: LockFile = {
      plugins: {
        good: {source: 'github:good/x', commit: 'abc123'},
        evil: {source: 'github:evil/x', commit: 'local'},
      },
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then the forged entry is still reported as an orphan -- its REMOTE source shape, not its
    // #self-declared commit, is what the exemption decision is keyed on
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['lock entry "evil" (github:evil/x) is not an enabled plugin in quartz.config.yaml'])
  })

  it('fails with a commit-mismatch error when a local-source lock entry does not record commit: "local"', () => {
    // #given a lock entry with a local `source` but a `commit` value other than the "local" sentinel
    // #-- an internal inconsistency in the lockfile itself, now that `commit` no longer participates
    // #in the exemption decision. Silently accepting this would let `commit` drift from meaning
    // #anything, so it is reported as an error rather than ignored
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {'local-plugin': {source: './local-plugin', commit: 'abc123'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails with the commit-mismatch error, not the orphan error
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'lock entry "local-plugin" has a local source but commit "abc123" is not "local" -- local plugins must record commit: "local"',
    ])
  })

  it('regression: every enabled github: plugin in the real quartz-site config matches its real lock entry', async () => {
    // #given the actual quartz-site/quartz.config.yaml and quartz.lock.json shipped in this repo
    const YAML = require('yaml') as typeof import('yaml')
    const configRaw = await readFile(join(process.cwd(), 'quartz-site', 'quartz.config.yaml'), 'utf8')
    const lockRaw = await readFile(join(process.cwd(), 'quartz-site', 'quartz.lock.json'), 'utf8')
    const config = YAML.parse(configRaw) as QuartzConfig
    const lock = JSON.parse(lockRaw) as LockFile

    // #when checking coverage against the real, stricter classification
    const result = checkLockfileCoverage(config, lock)

    // #then it still passes -- the real config uses only `github:` string sources and `./`-local
    // #object sources, none of which are affected by closing the exemption for the other 3 remote forms
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// isLocalPluginSource — the local-vs-remote exemption predicate, tested directly since it is
// exported and no other test in this file exercises every one of its four forms plus near-misses.
// ---------------------------------------------------------------------------

describe('isLocalPluginSource', () => {
  it.each([
    ['./p', true],
    ['../p', true],
    ['/p', true],
    [String.raw`C:\p`, true],
    ['C:/p', true],
  ])('returns %s for %j', (source, expected) => {
    // #when classifying the source
    const result = isLocalPluginSource(source)

    // #then it matches the expected local/remote classification
    expect(result).toBe(expected)
  })

  it('does not treat a dotfile-like name starting with "." as local (only "./" and "../" count)', () => {
    // #given a source starting with a bare "." but not "./" or "../" -- a near-miss that must not be
    // #misclassified as local
    expect(isLocalPluginSource('.hidden')).toBe(false)
  })

  it('does not treat a drive-letter-shaped prefix with no path separator as local', () => {
    // #given "C:foo" -- has the drive-letter form but no trailing `\` or `/`, so the Windows-path
    // #regex must not match it
    expect(isLocalPluginSource('C:foo')).toBe(false)
  })

  it('does not treat a bare relative path with no leading "./" as local', () => {
    // #given "p/q" -- a relative-looking path that nonetheless does not start with any of the four
    // #recognized local prefixes
    expect(isLocalPluginSource('p/q')).toBe(false)
  })

  it('does not treat a github: remote source as local', () => {
    expect(isLocalPluginSource('github:owner/repo')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isLocalLockEntry — the shared local-exemption predicate BOTH gates must use, keyed on the lock
// entry's own `source` shape and never on `entry.commit` (see the SECURITY test above for why).
// ---------------------------------------------------------------------------

describe('isLocalLockEntry', () => {
  it('is true for a string source that is local, regardless of commit', () => {
    expect(isLocalLockEntry({source: './p', commit: 'local'})).toBe(true)
    expect(isLocalLockEntry({source: './p', commit: 'not-local'})).toBe(true)
  })

  it('is true for an object source whose repo is local', () => {
    expect(isLocalLockEntry({source: {repo: './p'}, commit: 'local'})).toBe(true)
  })

  it('is false for a remote string source, regardless of commit', () => {
    expect(isLocalLockEntry({source: 'github:owner/repo', commit: 'local'})).toBe(false)
    expect(isLocalLockEntry({source: 'github:owner/repo', commit: 'abc123'})).toBe(false)
  })

  it('is false for an object source with no usable repo string', () => {
    expect(isLocalLockEntry({source: {}, commit: 'local'})).toBe(false)
    expect(isLocalLockEntry({source: {repo: 123 as unknown as string}, commit: 'local'})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkLockfileIntegrity — Gate B
// ---------------------------------------------------------------------------

describe('checkLockfileIntegrity', () => {
  it('skips a local-source entry entirely, never calling readHead for it', () => {
    // #given a lock entry with a local source and no corresponding readHead result (readHead would
    // #throw if ever called for it, proving the entry is skipped rather than looked up and passing
    // #by coincidence)
    const lock: LockFile = {plugins: {'local-plugin': {source: './local-plugin', commit: 'local'}}}
    const readHead = (name: string): string | null => {
      throw new Error(`readHead should not be called for local entry "${name}"`)
    }

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it passes without ever consulting .git/HEAD for the local entry
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails with a commit-mismatch error when a local-source entry does not record commit: "local", without consulting readHead', () => {
    // #given a lock entry with a local source but a non-"local" commit -- the same inconsistency
    // #Gate A reports, using the same shared predicate and the same error text
    const lock: LockFile = {plugins: {'local-plugin': {source: './local-plugin', commit: 'abc123'}}}
    const readHead = (name: string): string | null => {
      throw new Error(`readHead should not be called for local entry "${name}"`)
    }

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails with the commit-mismatch error, not a HEAD-comparison error
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      'lock entry "local-plugin" has a local source but commit "abc123" is not "local" -- local plugins must record commit: "local"',
    ])
  })

  it('AGREEMENT: a local-source lock entry is exempt in Gate A and skipped in Gate B, via the same predicate', () => {
    // #given a lock with one local entry and one remote entry, checked by BOTH gates -- this is the
    // #agreement itself under test: both gates must treat the local entry identically (exempt) using
    // #isLocalLockEntry, not disagree with each other via separate ad-hoc logic
    const lock: LockFile = {
      plugins: {
        'local-plugin': {source: './local-plugin', commit: 'local'},
        remote: {source: 'github:owner/repo', commit: 'sha-remote'},
      },
    }
    const config: QuartzConfig = {plugins: [{enabled: true, source: 'github:owner/repo'}]}
    const readHead = (name: string): string | null => (name === 'remote' ? 'sha-remote' : 'sha-should-not-be-used')

    // #when checking both gates
    const coverageResult = checkLockfileCoverage(config, lock)
    const integrityResult = checkLockfileIntegrity(lock, readHead)

    // #then both gates pass -- the local entry is exempt from Gate A's orphan check and skipped by
    // #Gate B's HEAD comparison, while the remote entry is fully verified by both
    expect(coverageResult.ok).toBe(true)
    expect(coverageResult.errors).toEqual([])
    expect(integrityResult.ok).toBe(true)
    expect(integrityResult.errors).toEqual([])
  })

  it('passes when every plugin HEAD matches its lock commit', () => {
    // #given a lock with two entries whose readHead returns the exact matching commit SHA
    const lock: LockFile = {
      plugins: {
        'plugin-a': {source: 'github:x/a', commit: 'sha-a'},
        'plugin-b': {source: 'github:x/b', commit: 'sha-b'},
      },
    }
    const readHead = (name: string): string | null => (name === 'plugin-a' ? 'sha-a' : 'sha-b')

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it passes
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails and names the plugin when a HEAD SHA does not match the lock commit', () => {
    // #given a plugin whose HEAD is a different commit than the lock records
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): string => 'sha-drifted'

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails naming the plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a'))).toBe(true)
  })

  it('fails when HEAD contains a branch ref instead of a pinned commit', () => {
    // #given a plugin checked out to a branch (HEAD is a ref line, not a SHA)
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): string => 'ref: refs/heads/main'

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails — branch drift never equals a pinned SHA
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a'))).toBe(true)
  })

  it('fails when the plugin directory/.git/HEAD is missing', () => {
    // #given a lock entry whose readHead returns null (directory absent)
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): null => null

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails naming the missing plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a') && e.toLowerCase().includes('missing'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// runCli — CLI integration against tmpdir fixtures
// ---------------------------------------------------------------------------

// These `runCli` tests exercise coverage mode against a real fixture cwd, so
// they need `yaml` resolvable from that cwd — mirroring the CI topology by
// symlinking THIS repo's own installed `yaml` package into the fixture's
// node_modules, rather than relying on a bare `import('yaml')` resolving
// upward from the script's own directory (the exact P0 this gate exists to
// avoid re-introducing).
async function symlinkRepoYamlInto(dir: string): Promise<void> {
  const repoYamlPkgJson = require.resolve('yaml/package.json')
  const repoYamlDir = dirname(repoYamlPkgJson)
  const nodeModules = join(dir, 'node_modules')
  await mkdir(nodeModules, {recursive: true})
  await symlink(repoYamlDir, join(nodeModules, 'yaml'), 'dir')
}

describe('runCli', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-'))
  })

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('coverage mode exits 0 on a valid fixture pair', async () => {
    // #given a config and lock that fully match, written to fixture files in cwd
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}}}),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 0 with a summary naming both the enabled-source and lock-entry counts
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n')
  })

  it('coverage mode pluralizes "entries" when more than one plugin is locked', async () => {
    // #given two enabled remote plugins each with a matching lock entry
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n  - enabled: true\n    source: github:quartz-community/plugin-b\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({
        plugins: {
          'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'},
          'plugin-b': {source: 'github:quartz-community/plugin-b', commit: 'def456'},
        },
      }),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 0 with the plural "lock entries" wording, not the singular "lock entry"
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile coverage gate passed: 2 enabled remote plugin(s) match 2 lock entries.\n')
  })

  it('coverage mode exits 1 with the error on stderr when the lock is tampered', async () => {
    // #given a config requiring a plugin that the lock omits (tampered/incomplete lock)
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 1 and reports the error on stderr
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('github:quartz-community/plugin-a')
  })

  it('coverage mode joins multiple failure lines with real newlines and leaves stdout empty', async () => {
    // #given two enabled remote plugins, both absent from the lock (tampered/incomplete lock)
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n  - enabled: true\n    source: github:quartz-community/plugin-b\n',
      'utf8',
    )
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then stdout stays empty and stderr is the exact heading plus both errors joined by real newlines
    // #(not concatenated together)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile coverage gate failed:\n' +
        '  - missing lock entry for enabled remote plugin: github:quartz-community/plugin-a\n' +
        '  - missing lock entry for enabled remote plugin: github:quartz-community/plugin-b\n',
    )
  })

  it('integrity mode exits 0 when all plugin HEADs match the lock', async () => {
    // #given a lock and a matching .quartz/plugins/<name>/.git/HEAD fixture
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'}}}),
      'utf8',
    )
    const headDir = join(dir, '.quartz', 'plugins', 'plugin-a', '.git')
    await mkdir(headDir, {recursive: true})
    await writeFile(join(headDir, 'HEAD'), 'sha-a\n', 'utf8')

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 0 with a summary and stderr stays empty
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
    expect(result.stderr).toBe('')
  })

  it('integrity mode treats a lockfile with no "plugins" key as zero plugins, without throwing', async () => {
    // #given a lock file that omits the "plugins" key entirely (not even an empty object)
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({}), 'utf8')

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 0 reporting zero plugins verified, not a thrown error
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile integrity gate passed: 0 plugin(s) verified against .git/HEAD.\n')
    expect(result.stderr).toBe('')
  })

  it('integrity mode exits 1 with the error on stderr when a plugin dir is missing', async () => {
    // #given a lock entry with no corresponding .quartz/plugins directory
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'}}}),
      'utf8',
    )

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 1 and reports the missing plugin on stderr, naming it "missing" (not "does not
    // #match", the message used for a HEAD/commit mismatch) -- proves the readHead directory-absent
    // #path is distinguished from the value-mismatch path
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plugin-a')
    expect(result.stderr.toLowerCase()).toContain('missing')
    expect(result.stderr.toLowerCase()).not.toContain('does not match')
  })

  it('integrity mode joins multiple failure lines with real newlines and leaves stdout empty', async () => {
    // #given two lock entries, neither with a corresponding .quartz/plugins directory
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({
        plugins: {
          'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'},
          'plugin-b': {source: 'github:quartz-community/plugin-b', commit: 'sha-b'},
        },
      }),
      'utf8',
    )

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then stdout stays empty and stderr is the exact heading plus both errors joined by real newlines
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile integrity gate failed:\n' +
        '  - missing plugin directory/.git/HEAD for "plugin-a"\n' +
        '  - missing plugin directory/.git/HEAD for "plugin-b"\n',
    )
  })

  it('exits 2 with a clear message for an unknown mode', async () => {
    // #when running the CLI with a mode that isn't "coverage" or "integrity"
    const result = await runCli(['bogus-mode'], dir)

    // #then it exits 2 naming the unknown mode, with stdout left empty
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('unknown mode "bogus-mode"')
  })

  it('exits 2 with the mode rendered as an empty string when no mode argument is given', async () => {
    // #when running the CLI with no argv at all (argv[0] is undefined)
    const result = await runCli([], dir)

    // #then it exits 2, stdout stays empty, and the unknown mode renders as "" rather than "undefined"
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('wiki-lockfile-gates: unknown mode "" (expected "coverage" or "integrity")\n')
  })
})

// ---------------------------------------------------------------------------
// runCli coverage mode — yaml resolution topology (the P0 this gate exists to catch)
// ---------------------------------------------------------------------------
//
// The publish-wiki build job's coverage step runs with cwd=quartz-build/ and
// NEVER runs `pnpm bootstrap` at the repo root — only `npm ci` inside
// quartz-build/. So repo-root node_modules does not exist in that job, and a
// bare `import('yaml')` resolved from this script's own directory (scripts/)
// would walk up to repo root and fail every time. These tests prove
// `runCli` resolves `yaml` from the WORKING DIRECTORY instead, by building a
// CI-shaped fixture tree that lives outside the repo (a fake
// quartz-build/node_modules/yaml, and — separately — no yaml at all).
describe('runCli coverage mode — yaml resolution topology', () => {
  let ciDir: string

  beforeEach(async () => {
    ciDir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-ci-topology-'))
  })

  afterEach(async () => {
    await rm(ciDir, {recursive: true, force: true})
  })

  it('resolves yaml from cwd/node_modules (not the script location) and exits 0', async () => {
    // #given a CI-shaped quartz-build/ dir with its OWN node_modules/yaml (Quartz's dependency,
    // not a repo-root one) plus a config with no plugins and a matching empty lock
    const quartzBuild = join(ciDir, 'quartz-build')
    await mkdir(quartzBuild, {recursive: true})
    await writeFile(join(quartzBuild, 'quartz.config.yaml'), 'plugins: []\n', 'utf8')
    await writeFile(join(quartzBuild, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')

    const fakeYamlDir = join(quartzBuild, 'node_modules', 'yaml')
    await mkdir(fakeYamlDir, {recursive: true})
    await writeFile(
      join(fakeYamlDir, 'package.json'),
      JSON.stringify({name: 'yaml', version: '0.0.0', main: 'index.js'}),
      'utf8',
    )
    // The fake only needs to prove RESOLUTION (found in quartz-build/node_modules,
    // not repo-root), not parsing fidelity — so it returns a hardcoded empty-plugins
    // config regardless of input, matching the empty-lock fixture above.
    await writeFile(
      join(fakeYamlDir, 'index.js'),
      'exports.parse = function parse() { return {plugins: []} }\n',
      'utf8',
    )

    // #when running the coverage CLI mode with cwd=quartz-build (the CI topology)
    const result = await runCli(['coverage'], quartzBuild)

    // #then it resolves the fake yaml from quartz-build/node_modules and passes
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
  })

  it('exits 2 with a clear resolution error when yaml is unreachable from cwd', async () => {
    // #given a CI-shaped quartz-build/ dir with NO node_modules/yaml at all, outside
    // the repo tree (so the createRequire-from-cwd walk-up never reaches this repo's
    // node_modules — proving the negative path is real, not an artifact of running
    // the test process from inside the repo)
    const quartzBuild = join(ciDir, 'quartz-build')
    await mkdir(quartzBuild, {recursive: true})
    await writeFile(join(quartzBuild, 'quartz.config.yaml'), 'plugins: []\n', 'utf8')
    await writeFile(join(quartzBuild, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], quartzBuild)

    // #then it exits 2 with a message naming the resolution root, not a hard crash, and stdout is empty
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('yaml')
    expect(result.stderr).toContain(quartzBuild)
  })
})

// ---------------------------------------------------------------------------
// main() — CLI self-invoke guard (import.meta.url === file://<argv[1]>)
// ---------------------------------------------------------------------------

// Every runCli-level test above imports the module without ever setting process.argv[1] to its own
// path, so the `false` branch of every mutator variant on the guard/main() wiring is trivially
// exercised already -- that alone does not kill the mutants on `main()`'s body or the guard condition
// itself. Cache-busts the dynamic import (unique query string) so the module's top-level code
// re-executes with the manipulated argv/cwd, rather than returning the already-cached module instance.
// Note: these tests exercise main()'s body and its wiring to runCli/process, not the guard predicate
// itself -- vitest strips the query string from import.meta.url before the equality check runs, and a
// real production invocation never carries one either, so the query string is purely a test-isolation
// device, not something the guard has to tolerate.
describe('main() CLI self-invoke guard', () => {
  it("does NOT invoke main() when process.argv[1] does not match the module's own path (positive control)", async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', '/some/unrelated/entrypoint.js']
    try {
      await import(`${modulePath.href}?guard-test-noop`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })

  it('invokes main() and writes the coverage-mode success message to stdout without calling process.exit', async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const dir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-main-'))

    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}}}),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    // `process.chdir()` is unsupported inside vitest's worker threads -- stub `process.cwd()` instead,
    // which is the only thing main() actually reads (`runCli(process.argv.slice(2), process.cwd())`).
    // `mockImplementationOnce` because main() reads cwd exactly once; if that ever changes, switch to a
    // scoped `mockImplementation` with an explicit restore in `finally` instead of widening this to serve
    // unlimited calls.
    vi.spyOn(process, 'cwd').mockImplementationOnce(() => dir)

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname, 'coverage']
    try {
      await import(`${modulePath.href}?guard-test-main-coverage-ok`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toBe(
        'Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n',
      )
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('invokes main() and exits with the unknown-mode message on stderr for a nonzero exit code', async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname, 'totally-bogus']
    try {
      await expect(import(`${modulePath.href}?guard-test-main-bogus-mode`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrOutput.join('')).toBe(
        'wiki-lockfile-gates: unknown mode "totally-bogus" (expected "coverage" or "integrity")\n',
      )
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })
})
