/** Normalize the exact survival text used by both storage validation and ingest checks. */
export function normalizeCorrectionText(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ')
}
