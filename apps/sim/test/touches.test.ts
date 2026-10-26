import { describe, expect, test } from 'bun:test'
import { tapUntilReceived } from '../src/ui/touches'
import { AppTimeout } from '../src/wait'

/**
 * An app whose touch count rises on the taps `received` lists, by their
 * number from 1, and an element that stays on screen until `goneAfter` taps.
 */
function app(opts: { received: number[]; goneAfter?: number; countFails?: boolean }) {
  let taps = 0
  let touches = 0
  return {
    get taps() {
      return taps
    },
    run: (lost: number[] = []) =>
      tapUntilReceived({
        what: '{"label":"Files"}',
        send: async () => {
          taps++
          if (opts.received.includes(taps)) touches++
        },
        count: async () => (opts.countFails ? null : touches),
        stillThere: async () => opts.goneAfter === undefined || taps < opts.goneAfter,
        onLost: (attempt) => lost.push(attempt),
        windowMs: 50,
      }),
  }
}

describe('tapUntilReceived', () => {
  test('a tap the app received is sent once', async () => {
    const a = app({ received: [1] })
    expect(await a.run()).toBe('received')
    expect(a.taps).toBe(1)
  })

  test('a tap the app never received is sent again until it is', async () => {
    const a = app({ received: [3] })
    const lost: number[] = []
    expect(await a.run(lost)).toBe('received')
    expect(a.taps).toBe(3)
    expect(lost).toEqual([1, 2])
  })

  test('three taps the app never received fail the step', async () => {
    const a = app({ received: [] })
    const err = await a.run().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppTimeout)
    expect((err as Error).message).toBe('The app received none of 3 taps on {"label":"Files"}')
    expect(a.taps).toBe(3)
  })

  test('a touch counted only on the second read after the tap is received', async () => {
    // The app's JavaScript thread was busy, so the first read answered
    // before the touch was counted, after the window had already passed.
    let reads = 0
    let taps = 0
    const outcome = await tapUntilReceived({
      what: '{"label":"Files"}',
      send: async () => {
        taps++
      },
      count: async () => {
        reads++
        return reads >= 3 ? 1 : 0
      },
      stillThere: async () => true,
      windowMs: 0,
    })
    expect(outcome).toBe('received')
    expect(taps).toBe(1)
  })

  test('a tap whose element went without the app seeing it is not sent again', async () => {
    // A system dialog over the app takes the tap and closes.
    const a = app({ received: [], goneAfter: 1 })
    expect(await a.run()).toBe('gone')
    expect(a.taps).toBe(1)
  })

  test('a tap is sent once when the app cannot report its count', async () => {
    const a = app({ received: [], countFails: true })
    expect(await a.run()).toBe('unknown')
    expect(a.taps).toBe(1)
  })
})
