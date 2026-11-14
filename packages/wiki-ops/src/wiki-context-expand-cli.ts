/**
 * The `scripts/wiki-context-expand.ts` entrypoint, an operator tool:
 * `bun scripts/wiki-context-expand.ts query "<text>"`. Query text may start with `-`, so it keeps its
 * hand-written argv parser rather than the goke runner, which would read that text as a flag. The
 * command is read-only: it reads the wiki and prints one JSON result.
 */

import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import {runWikiContextExpandCli} from './wiki-context-expand.ts'

async function nodeReadDir(path: string): Promise<{name: string; isFile: () => boolean}[]> {
  return readdir(path, {withFileTypes: true})
}

async function nodeReadFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

export async function main(): Promise<void> {
  const outcome = await runWikiContextExpandCli({
    argv: process.argv.slice(2),
    readDir: nodeReadDir,
    readFile: nodeReadFile,
    writeStdout: chunk => process.stdout.write(chunk),
    writeStderr: chunk => process.stderr.write(chunk),
  })
  process.exitCode = outcome.exitCode
}
