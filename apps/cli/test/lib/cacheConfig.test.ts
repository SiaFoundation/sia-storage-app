import { formatCacheAge, parseCacheAge } from '../../src/lib/cacheConfig'

describe('cache age input', () => {
  it('reads seconds, minutes, hours, days and zero', () => {
    expect(parseCacheAge('30s')).toBe(30_000)
    expect(parseCacheAge('5m')).toBe(300_000)
    expect(parseCacheAge('12h')).toBe(43_200_000)
    expect(parseCacheAge('3d')).toBe(259_200_000)
    expect(parseCacheAge('0')).toBe(0)
  })

  it('rejects a bare number other than zero, and unknown units', () => {
    for (const input of ['60', '1w', 'abc', '-1d']) {
      expect(parseCacheAge(input)).toBeUndefined()
    }
  })

  it('prints the largest whole unit', () => {
    expect(formatCacheAge(86_400_000)).toBe('1d')
    expect(formatCacheAge(43_200_000)).toBe('12h')
    expect(formatCacheAge(90_000)).toBe('90s')
    expect(formatCacheAge(0)).toBe('0ms')
  })
})
