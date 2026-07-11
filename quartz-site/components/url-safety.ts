/**
 * Pure URL-scheme guard shared by wiki-facing components. No Quartz imports —
 * keep this file importable from the root workspace's test runner.
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
