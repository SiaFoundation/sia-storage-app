const { deriveAppVersion } = require('./appVersion')

describe('deriveAppVersion', () => {
  test('a stable version keeps its marketing version and encodes with the final slot', () => {
    expect(deriveAppVersion('1.14.0')).toEqual({
      marketingVersion: '1.14.0',
      versionCode: 1140099,
      buildNumber: '1140099',
    })
  })

  test('a release candidate strips the suffix and encodes its rc number', () => {
    expect(deriveAppVersion('1.14.0-rc.0')).toEqual({
      marketingVersion: '1.14.0',
      versionCode: 1140000,
      buildNumber: '1140000',
    })
    expect(deriveAppVersion('1.14.0-rc.12').versionCode).toBe(1140012)
  })

  test('codes strictly increase from rc to final to the next version', () => {
    const codes = [
      deriveAppVersion('1.14.0-rc.0').versionCode,
      deriveAppVersion('1.14.0-rc.1').versionCode,
      deriveAppVersion('1.14.0').versionCode,
      deriveAppVersion('1.14.1-rc.0').versionCode,
      deriveAppVersion('1.15.0-rc.0').versionCode,
      deriveAppVersion('2.0.0-rc.0').versionCode,
    ]
    expect([...codes].sort((a, b) => a - b)).toEqual(codes)
    expect(new Set(codes).size).toBe(codes.length)
  })

  test('every new code outranks the pre-rc scheme used through 1.13.4', () => {
    const lastShipped = 1 * 10000 + 13 * 100 + 4
    expect(deriveAppVersion('1.14.0-rc.0').versionCode).toBeGreaterThan(lastShipped)
  })

  test('rejects versions the encoding cannot represent', () => {
    expect(() => deriveAppVersion('1.100.0')).toThrow('overflows')
    expect(() => deriveAppVersion('1.0.100')).toThrow('overflows')
    expect(() => deriveAppVersion('1.14.0-rc.99')).toThrow('overflows')
  })

  test('rejects prerelease labels other than rc and malformed versions', () => {
    for (const bad of ['1.14.0-beta.1', '1.14.0-rc', '1.14', 'v1.14.0', '1.14.0-rc.1.2']) {
      expect(() => deriveAppVersion(bad)).toThrow('unsupported')
    }
  })
})
