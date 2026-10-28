import { LocalCopyLock } from './localCopyLock'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('LocalCopyLock', () => {
  it('runs holders of one file one after another, in order', async () => {
    const lock = new LocalCopyLock()
    const order: string[] = []
    const first = deferred()

    const a = lock.run('f', async () => {
      order.push('a start')
      await first.promise
      order.push('a end')
    })
    const b = lock.run('f', async () => {
      order.push('b')
    })
    await Promise.resolve()
    first.resolve()
    await Promise.all([a, b])

    expect(order).toEqual(['a start', 'a end', 'b'])
  })

  it('lets different files run at once', async () => {
    const lock = new LocalCopyLock()
    const held = deferred()
    const a = lock.run('a', () => held.promise)

    let ranB = false
    await lock.run('b', async () => {
      ranB = true
    })
    held.resolve()
    await a

    expect(ranB).toBe(true)
  })

  it('skips a try while the file is held, and runs it once released', async () => {
    const lock = new LocalCopyLock()
    const held = deferred()
    const holder = lock.run('f', () => held.promise)

    expect(await lock.tryRun('f', async () => 'removed')).toEqual({ ran: false })
    held.resolve()
    await holder
    expect(await lock.tryRun('f', async () => 'removed')).toEqual({ ran: true, value: 'removed' })
    expect(lock.isHeld('f')).toBe(false)
  })

  it('releases the lock when the holder throws', async () => {
    const lock = new LocalCopyLock()

    await expect(
      lock.run('f', async () => {
        throw new Error('write failed')
      }),
    ).rejects.toThrow('write failed')

    expect(lock.isHeld('f')).toBe(false)
  })
})
