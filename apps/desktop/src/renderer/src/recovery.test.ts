import { describe, expect, it } from 'bun:test'
import { watchRecovery } from './recovery'

describe('refreshing after the daemon answers again', () => {
  it('does not refresh for a daemon that answers from the first read', () => {
    let refreshes = 0
    const observe = watchRecovery(() => refreshes++)
    observe(true)
    observe(true)
    expect(refreshes).toBe(0)
  })

  it('refreshes once on the first answer after a run of reads that failed', () => {
    let refreshes = 0
    const observe = watchRecovery(() => refreshes++)
    observe(false)
    observe(false)
    observe(false)
    expect(refreshes).toBe(0)
    observe(true)
    observe(true)
    expect(refreshes).toBe(1)
  })

  it('refreshes again after a second stall', () => {
    let refreshes = 0
    const observe = watchRecovery(() => refreshes++)
    observe(true)
    observe(false)
    observe(true)
    observe(false)
    observe(true)
    expect(refreshes).toBe(2)
  })
})
