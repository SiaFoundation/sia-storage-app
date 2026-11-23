import { describe, expect, it } from 'bun:test'
import { createRemount } from './remount'

/** A register the test finishes when it chooses, as one still confirming with the system. */
function controlledStart() {
  const pending: Array<() => void> = []
  let started = 0
  const start = () =>
    new Promise<void>((resolve) => {
      started += 1
      pending.push(resolve)
    })
  return { start, started: () => started, finishNext: () => pending.shift()?.() }
}

describe('registering the Finder folder again when the daemon comes back', () => {
  it('registers again for a daemon that came back while the last register was still confirming', async () => {
    const register = controlledStart()
    const remount = createRemount(register.start, () => false)

    const first = remount()
    await Bun.sleep(0)
    const second = remount()
    await Bun.sleep(0)
    expect(register.started()).toBe(1)

    register.finishNext()
    await first
    await Bun.sleep(0)
    expect(register.started()).toBe(2)
    register.finishNext()
    await second
  })

  it('does not register once the app has begun quitting', async () => {
    let quitting = false
    const register = controlledStart()
    const remount = createRemount(register.start, () => quitting)

    const first = remount()
    await Bun.sleep(0)
    const second = remount()
    quitting = true
    register.finishNext()
    await Promise.all([first, second])

    expect(register.started()).toBe(1)
  })

  it('keeps registering after a register that threw', async () => {
    let calls = 0
    const remount = createRemount(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('agent failed')
      },
      () => false,
    )

    await remount()
    await remount()

    expect(calls).toBe(2)
  })
})
