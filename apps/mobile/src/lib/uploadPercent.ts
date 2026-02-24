/**
 * Format a decimal upload percentage as a fixed-width string.
 * Always shows 1 decimal place and pads to 6 characters (e.g. " 99.3%").
 * Used in the status sheet where alignment matters.
 */
export function humanUploadPercent(decimal?: number, fallback?: string) {
  if (decimal == null) return fallback ?? '100.0%'
  const pct = (decimal * 100).toFixed(1)
  return `${pct}%`.padStart(6)
}

/**
 * Format a decimal upload percentage for compact display (e.g. header pill).
 * Shows 0 decimal places. Returns null when >= 99% so the caller can
 * show just a spinner instead.
 */
export function compactUploadPercent(decimal: number): string | null {
  if (decimal >= 0.99) return null
  return `${Math.round(decimal * 100)}%`
}
