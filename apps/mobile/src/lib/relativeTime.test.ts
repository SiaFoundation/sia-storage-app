import { relativeTimeLabel } from './relativeTime'

// A fixed Monday noon keeps weekday/year boundaries deterministic.
const NOW = new Date('2026-07-06T12:00:00').getTime()

const ago = (ms: number) => relativeTimeLabel(NOW - ms, NOW)

describe('relativeTimeLabel', () => {
  it('tiers by age', () => {
    expect(ago(59_000)).toBe('Just now')
    expect(ago(61_000)).toBe('1m ago')
    expect(ago(59 * 60_000)).toBe('59m ago')
    expect(ago(61 * 60_000)).toBe('1h ago')
    expect(ago(25 * 3_600_000)).toBe('Yesterday')
    expect(ago(3 * 86_400_000)).toBe('Fri') // weekday within the last week
  })

  it('falls to a date past a week, adding the year across a rollover', () => {
    expect(ago(10 * 86_400_000)).toBe('Jun 26')
    expect(relativeTimeLabel(new Date('2025-07-02T12:00:00').getTime(), NOW)).toBe('Jul 2, 2025')
  })
})
