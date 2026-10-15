import { describe, expect, it } from 'bun:test'
import { compareVersions, parseVersion } from './versions'

describe('release version order', () => {
  it.each([
    ['1.2.0-rc.0', '1.2.0-rc.1'],
    ['1.2.0-rc.9', '1.2.0-rc.10'],
    ['1.2.0-rc.3', '1.2.0'],
    ['1.2.0', '1.2.1-rc.0'],
    ['1.2.9', '1.10.0'],
    ['0.9.9', '1.0.0-rc.0'],
  ])('%s is older than %s', (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0)
    expect(compareVersions(newer, older)).toBeGreaterThan(0)
  })

  it('finds a version equal to itself', () => {
    expect(compareVersions('1.2.0-rc.1', '1.2.0-rc.1')).toBe(0)
  })

  it.each(['1.2', 'v1.2.0', '1.2.0-beta.1', '1.2.0-rc', ''])('does not order %p', (version) => {
    expect(parseVersion(version)).toBeNull()
    expect(() => compareVersions(version, '1.0.0')).toThrow(/Cannot compare/)
  })
})
