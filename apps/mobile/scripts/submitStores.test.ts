import { describe, expect, test } from 'bun:test'
import { parseCommand } from './submitStores'

describe('the store command', () => {
  test('submits a candidate tag to one store', () => {
    expect(parseCommand(['submit', 'android', 'mobile/v1.15.1-rc.3', '--dry-run'])).toEqual({
      kind: 'submit',
      platform: 'android',
      tag: 'mobile/v1.15.1-rc.3',
    })
  })

  test('releases an approved App Store version', () => {
    expect(parseCommand(['release', 'ios', '1.15.1'])).toEqual({
      kind: 'release',
      platform: 'ios',
      version: '1.15.1',
    })
  })

  test('the form a candidate cut before the change runs releases the version', () => {
    expect(parseCommand(['ios', '1.15.1'])).toEqual({
      kind: 'release',
      platform: 'ios',
      version: '1.15.1',
    })
    expect(parseCommand(['android', '1.15.1'])).toEqual({
      kind: 'release',
      platform: 'android',
      version: '1.15.1',
    })
  })

  test('anything else is refused', () => {
    expect(() => parseCommand(['release', 'android', '1.15.1'])).toThrow('usage')
    expect(() => parseCommand(['submit', 'ios'])).toThrow('usage')
    expect(() => parseCommand(['ios', '1.15.1-rc.3'])).toThrow('usage')
  })
})
