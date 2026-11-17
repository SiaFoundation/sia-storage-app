/* Parsing and printing for the cache hold time `sia config` sets. */

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export const CACHE_AGE_FORMS = '`0` or a duration such as 30s, 12h or 3d'

/** Milliseconds for a duration, undefined when the input is not one. */
export function parseCacheAge(input: string): number | undefined {
  const text = input.trim()
  if (text === '0') return 0
  const match = /^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(text)
  if (!match) return undefined
  return Math.floor(Number(match[1]) * DURATION_UNITS[match[2]])
}

export function formatCacheAge(ms: number): string {
  for (const unit of ['d', 'h', 'm', 's']) {
    const scale = DURATION_UNITS[unit]
    if (ms >= scale && ms % scale === 0) return `${ms / scale}${unit}`
  }
  return `${ms}ms`
}
