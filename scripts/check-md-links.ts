import {readdir, readFile} from 'node:fs/promises'
import {join, relative} from 'node:path'
import process from 'node:process'

import {resolveMarkdownLinks} from './markdown-links.ts'

export interface MarkdownLinkFinding {
  readonly path: string
  readonly line: number
  readonly target: string
}

/** Check root-level markdown files and markdown files below docs/ for broken relative links. */
export async function checkMarkdownLinks(rootDir: string = process.cwd()): Promise<MarkdownLinkFinding[]> {
  const paths = await collectMarkdownPaths(rootDir)
  const findings: MarkdownLinkFinding[] = []

  for (const path of paths) {
    const content = await readFile(join(rootDir, path), 'utf8')
    for (const link of resolveMarkdownLinks(content, path, {rootDir})) {
      if (!link.exists) {
        findings.push({path, line: link.line, target: link.target})
      }
    }
  }

  return findings
}

async function collectMarkdownPaths(rootDir: string): Promise<string[]> {
  const paths: string[] = []
  const rootEntries = await readdir(rootDir, {withFileTypes: true})

  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(entry.name)
    }
  }

  const docsDirectory = join(rootDir, 'docs')
  await collectMarkdownPathsUnder(docsDirectory, rootDir, paths)

  return paths.sort()
}

async function collectMarkdownPathsUnder(directory: string, rootDir: string, paths: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, {withFileTypes: true})
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return
    throw error
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdownPathsUnder(path, rootDir, paths)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(relative(rootDir, path).replaceAll('\\', '/'))
    }
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export async function main(): Promise<void> {
  const findings = await checkMarkdownLinks()
  if (findings.length === 0) return

  for (const finding of findings) {
    process.stderr.write(`${finding.path}:${finding.line} -> ${finding.target}\n`)
  }
  process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
