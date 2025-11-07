/**
 * Format a decimal upload percentage as a human-readable string.
 * If the decimal is between 0.99 and 1, it will be formatted to 1 decimal place.
 * @param decimal - The decimal upload percentage (0-1).
 * @param fallback - The fallback string to return if the decimal is null.
 * @returns The human-readable string.
 */
export function humanUploadPercent(decimal?: number, fallback?: string) {
  if (decimal == null) return fallback ?? '100%'
  if (decimal >= 0.99 && decimal < 1) return `${(decimal * 100).toFixed(1)}%`
  return `${Math.round(decimal * 100)}%`
}
