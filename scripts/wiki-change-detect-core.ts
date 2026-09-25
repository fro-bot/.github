import type {Buffer} from 'node:buffer'

import {createHash} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'

import {parseGitStatusPorcelainZ} from './wiki-handoff-core.ts'

/**
 * A plain `git diff` misses untracked files, so a first survey's brand-new repo page never
 * registers as a change. Hashing the scoped tracked diff plus the sorted changed-path list
 * (untracked and modified alike, from `git status`) and their contents closes that gap —
 * an untracked file's content is re-read and re-hashed on every call, so an unedited
 * untracked file hashes the same at baseline and detect time, and an edited one doesn't.
 */

export interface ComputeWikiChangeHashParams {
  cwd: string
  runGitDiff: () => Promise<string>
  runGitStatus: () => Promise<string>
  readFileImpl?: typeof fs.readFile
}

/** Baseline and detect share this: same tracked-diff plus untracked-aware hash, so their outputs are directly comparable. */
export async function computeWikiChangeHash(params: ComputeWikiChangeHashParams): Promise<string> {
  const readFileImpl = params.readFileImpl ?? fs.readFile

  const diff = await params.runGitDiff()
  const statusOutput = await params.runGitStatus()
  const {changed} = parseGitStatusPorcelainZ(statusOutput)
  const sortedChanged = [...new Set(changed)].sort()

  const hash = createHash('sha256')
  hash.update(diff)
  for (const relativePath of sortedChanged) {
    const contents: Buffer = await readFileImpl(path.join(params.cwd, relativePath))
    hash.update(relativePath)
    hash.update('\0')
    hash.update(contents)
    hash.update('\0')
  }

  return hash.digest('hex')
}
