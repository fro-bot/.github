/**
 * Canonical `docs/solutions/` category directories. Neutral on purpose: pattern synthesis,
 * pattern clustering, and the drafted-solutions handoff policy all depend on this list, and
 * none of them should depend on each other to get it.
 */

/** Canonical `docs/solutions/` subdirectories. A new category is a deliberate change here. */
export const SOLUTION_SUBDIRS = [
  'best-practices',
  'documentation-gaps',
  'integration-issues',
  'runtime-errors',
  'security-issues',
  'workflow-issues',
] as const
