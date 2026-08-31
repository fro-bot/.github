/** Normalize the exact survival text used by both storage validation and ingest checks. */
export function normalizeCorrectionText(value) {
    return value.trim().replaceAll(/\s+/gu, ' ');
}
