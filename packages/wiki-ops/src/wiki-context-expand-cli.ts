/**
 * The `scripts/wiki-context-expand.ts` entrypoint. The agent runs it from a shell
 * (`WIKI_CONTEXT_HANDOFF_PATH='<path>' bun scripts/wiki-context-expand.ts linked`, or
 * `bun scripts/wiki-context-expand.ts query "<text>"`), and query text may start with `-`. It keeps its
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
    env: process.env,
    readDir: nodeReadDir,
    readFile: nodeReadFile,
    writeStdout: chunk => process.stdout.write(chunk),
    writeStderr: chunk => process.stderr.write(chunk),
  })
  process.exitCode = outcome.exitCode
}
