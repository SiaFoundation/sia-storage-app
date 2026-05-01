/**
 * Format a decimal upload percentage for compact display (e.g. header pill).
 * Shows 0 decimal places. Returns null when >= 99% so the caller can
 * show just a spinner instead.
 */
export function compactUploadPercent(decimal: number): string | null {
  if (decimal >= 0.99) return null
  return `${Math.round(decimal * 100)}%`
}
