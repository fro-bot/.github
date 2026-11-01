/**
 * The reconcile issue labels. Colors match `.github/settings.yml`, which declares every label (the settings
 * sync deletes undeclared ones); `settings-labels-effective-set.test.ts` pins both against it. A leaf with no
 * imports, so a test can read the constants without loading Octokit or an executor.
 */

export const PENDING_REVIEW_LABEL = 'reconcile:pending-review'

export const ROLLUP_LABEL = 'reconcile:rollup-pending-review'

export const INTEGRITY_ALERT_LABEL = 'reconcile:integrity-alert'

export const VISIBILITY_TRANSITION_LABEL = 'reconcile:visibility-transition'

export const RENAME_PENDING_LABEL = 'reconcile:rename-pending'

// Colors match .github/settings.yml (hex without '#', as GitHub createLabel requires)
export const TRANSITION_LABELS = [
  {
    name: VISIBILITY_TRANSITION_LABEL,
    color: 'f97316',
    description: 'Tracked repo transitioned from public to private',
  },
  {
    name: INTEGRITY_ALERT_LABEL,
    color: 'e11d48',
    description: 'Integrity alert requiring manual operator review',
  },
] as const

// Kept apart from TRANSITION_LABELS so the visibility/integrity paths still create exactly their
// own two labels. Like them, it is declared in `.github/settings.yml` (the settings sync deletes
// undeclared labels) and pinned against it by `settings-labels-effective-set.test.ts`.
export const RENAME_PENDING_LABELS = [
  {
    name: RENAME_PENDING_LABEL,
    color: '0ea5e9',
    description: 'Tracked repo was renamed on GitHub; dispatch rename-tracked-repo to apply',
  },
] as const
