import {
  formatCacheAge,
  formatCacheSize,
  parseCacheAge,
  parseCacheSize,
} from '../../src/lib/cacheConfig'

describe('cache size input', () => {
  it('reads decimal units, plain bytes, zero and off', () => {
    expect(parseCacheSize('10GB')).toBe(10_000_000_000)
    expect(parseCacheSize('500MB')).toBe(500_000_000)
    expect(parseCacheSize('1.5 gb')).toBe(1_500_000_000)
    expect(parseCacheSize('4096')).toBe(4096)
    expect(parseCacheSize('0')).toBe(0)
    expect(parseCacheSize('off')).toBeNull()
  })

  it('rejects anything else', () => {
    for (const input of ['abc', '10GiB', '-5GB', '', 'GB']) {
      expect(parseCacheSize(input)).toBeUndefined()
    }
  })

  it('prints the default as 4 GB and off as off', () => {
    expect(formatCacheSize(4_000_000_000)).toBe('4 GB')
    expect(formatCacheSize(1_500_000)).toBe('1.5 MB')
    expect(formatCacheSize(0)).toBe('0 B')
    expect(formatCacheSize(null)).toBe('off')
  })
})

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
