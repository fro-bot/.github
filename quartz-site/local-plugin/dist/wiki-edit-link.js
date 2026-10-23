// The dashboard owns this contract: fro-bot/dashboard `docs/runbooks/wiki-editor.md`,
// "The `/wiki/<id>` contract". Its ID rule lives in `src/wiki/paths.ts` (`parsePageId`)
// and `web/src/wiki/location.ts` (`isWikiPageId`). Keep this file in step with both.
export const WIKI_EDITOR_URL_BASE = "https://dashboard.fro.bot/wiki/"

const MAX_PAGE_ID_LENGTH = 200
const PAGE_PATH = /^knowledge\/wiki\/(repos|topics|entities|comparisons)\/([^/]+)\.md$/u
const PAGE_ID = /^(?:repos|topics|entities|comparisons)\.[A-Za-z0-9](?:[\w.-]*[A-Za-z0-9])?$/u

/**
 * The dashboard page ID for a repo-relative source path, or null when the path is not an
 * editable page or the ID would fail the dashboard's rule. Derived from the path only, never
 * from frontmatter.
 */
export function wikiPageId(sourcePath) {
  const match = PAGE_PATH.exec(sourcePath)
  if (match === null) {
    return null
  }
  const id = `${match[1]}.${match[2]}`
  if (id.length > MAX_PAGE_ID_LENGTH || id.includes("..") || !PAGE_ID.test(id)) {
    return null
  }
  return id
}

/** The dashboard editor URL for a repo-relative source path, or null when the page has no ID. No query string. */
export function wikiEditUrl(sourcePath) {
  const id = wikiPageId(sourcePath)
  return id === null ? null : `${WIKI_EDITOR_URL_BASE}${id}`
}
