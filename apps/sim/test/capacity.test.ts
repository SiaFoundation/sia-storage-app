import { describe, expect, test } from 'bun:test'
import { refusal } from '../src/capacity'

describe('refusal', () => {
  test('the first phone boots even when the budget is smaller than one phone', () => {
    expect(refusal('android', { ios: 0, android: 0 }, 1, 1)).toBeNull()
  })

  test('a phone boots while the booted phones and it fit the budget', () => {
    expect(refusal('ios', { ios: 1, android: 0 }, 3, 1)).toBeNull()
  })

  test('a phone that would take the booted phones past the budget waits', () => {
    expect(refusal('ios', { ios: 2, android: 0 }, 4, 1)).toContain('3.0 GB of the 4.0 GB budget')
  })

  test('booted phones of every kind count against the budget', () => {
    expect(refusal('ios', { ios: 0, android: 2 }, 10, 1)).toContain('9.0 GB of the 10.0 GB')
  })

  test('memory pressure stops even the first phone', () => {
    expect(refusal('ios', { ios: 0, android: 0 }, 100, 2)).toBe('macOS reports memory pressure')
  })
})
