/*
 * Parsing and printing for the cache settings `sia config` sets. Sizes use
 * decimal units, as the 4 GB default (`FS_MAX_BYTES`, 4,000,000,000 bytes)
 * does, so `4GB` sets exactly the default.
 */

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export const CACHE_SIZE_FORMS = '`off`, bytes, or a size such as 500MB or 10GB'
export const CACHE_AGE_FORMS = '`0` or a duration such as 30s, 12h or 3d'

/** Bytes for a size, null for `off`, undefined when the input is not a size. */
export function parseCacheSize(input: string): number | null | undefined {
  const text = input.trim()
  if (text.toLowerCase() === 'off') return null
  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(text)
  if (!match) return undefined
  const unit = match[2].toUpperCase() || 'B'
  const scale = SIZE_UNITS[unit]
  if (scale === undefined) return undefined
  return Math.floor(Number(match[1]) * scale)
}

/** Milliseconds for a duration, undefined when the input is not one. */
export function parseCacheAge(input: string): number | undefined {
  const text = input.trim()
  if (text === '0') return 0
  const match = /^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(text)
  if (!match) return undefined
  return Math.floor(Number(match[1]) * DURATION_UNITS[match[2]])
}

export function formatCacheSize(bytes: number | null): string {
  if (bytes === null) return 'off'
  for (const unit of ['TB', 'GB', 'MB', 'KB']) {
    const scale = SIZE_UNITS[unit]
    if (bytes >= scale) return `${Number((bytes / scale).toFixed(2))} ${unit}`
  }
  return `${bytes} B`
}

export function formatCacheAge(ms: number): string {
  for (const unit of ['d', 'h', 'm', 's']) {
    const scale = DURATION_UNITS[unit]
    if (ms >= scale && ms % scale === 0) return `${ms / scale}${unit}`
  }
  return `${ms}ms`
}
