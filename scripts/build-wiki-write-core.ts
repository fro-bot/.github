import type {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, relative, resolve, sep} from 'node:path'
import process from 'node:process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(repositoryRoot, 'packages', 'wiki-write-core', 'src')
const distRoot = join(repositoryRoot, 'packages', 'wiki-write-core', 'dist')
const buildConfig = join(repositoryRoot, 'packages', 'wiki-write-core', 'tsconfig.build.json')
const sourceHashPlaceholder = '__SOURCE_TREE_HASH__'

const checkOnly = process.argv.includes('--check')

async function main(): Promise<void> {
  const temporaryRoot = checkOnly ? await mkdtemp(join(tmpdir(), 'wiki-write-core-dist-')) : undefined
  const outputRoot = temporaryRoot ?? distRoot

  try {
    if (!checkOnly) {
      await rm(distRoot, {force: true, recursive: true})
    }
    await mkdir(outputRoot, {recursive: true})

    execFileSync('pnpm', ['exec', 'tsc', '--project', buildConfig, '--outDir', outputRoot, '--pretty', 'false'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    })

    const sourceHash = await computeSourceTreeHash()
    await embedSourceTreeHash(outputRoot, sourceHash)
    await rewriteDeclarationExtensions(outputRoot)

    if (checkOnly) {
      const differences = await compareTrees(outputRoot, distRoot)
      if (differences.length > 0) {
        throw new Error(`wiki-write-core dist is stale:\n${differences.map(path => `- ${path}`).join('\n')}`)
      }
      process.stdout.write('wiki-write-core dist is up to date\n')
    }
  } finally {
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  }
}

async function computeSourceTreeHash(): Promise<string> {
  const files = (await collectFiles(sourceRoot))
    .filter(path => !path.endsWith('.test.ts'))
    .sort((left, right) => left.localeCompare(right))
  const hash = createHash('sha256')

  for (const path of files) {
    const relativePath = relative(sourceRoot, path).split(sep).join('/')
    const content = await readFile(path)
    hash.update(relativePath)
    hash.update('\0')
    hash.update(String(content.byteLength))
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }

  return hash.digest('hex')
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true})
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

async function embedSourceTreeHash(outputRoot: string, sourceHash: string): Promise<void> {
  const contractPath = join(outputRoot, 'gate-contract.js')
  const content = await readFile(contractPath, 'utf8')
  const occurrences = content.split(sourceHashPlaceholder).length - 1
  if (occurrences !== 1) {
    throw new Error(`expected one source-tree hash placeholder in ${contractPath}, found ${occurrences}`)
  }
  await writeFile(contractPath, content.replace(sourceHashPlaceholder, sourceHash), 'utf8')
}

async function rewriteDeclarationExtensions(outputRoot: string): Promise<void> {
  for (const path of await collectFiles(outputRoot)) {
    if (!path.endsWith('.d.ts')) continue
    const content = await readFile(path, 'utf8')
    const rewritten = content.replaceAll(/(['"])(\.\.?\/[^'"]+)\.ts\1/gu, '$1$2.js$1')
    if (rewritten !== content) {
      await writeFile(path, rewritten, 'utf8')
    }
  }
}

async function compareTrees(leftRoot: string, rightRoot: string): Promise<string[]> {
  const [leftFiles, rightFiles] = await Promise.all([collectFiles(leftRoot), collectFiles(rightRoot)])
  const allPaths = new Set([
    ...leftFiles.map(path => relative(leftRoot, path)),
    ...rightFiles.map(path => relative(rightRoot, path)),
  ])
  const differences: string[] = []

  for (const relativePath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const leftPath = join(leftRoot, relativePath)
    const rightPath = join(rightRoot, relativePath)
    let leftContent: Buffer | undefined
    let rightContent: Buffer | undefined

    try {
      leftContent = await readFile(leftPath)
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) throw error
    }

    try {
      rightContent = await readFile(rightPath)
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) throw error
    }

    if (leftContent === undefined || rightContent === undefined || !leftContent.equals(rightContent)) {
      differences.push(relativePath)
    }
  }

  return differences
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
