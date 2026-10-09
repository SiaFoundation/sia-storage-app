import { Mutex } from './mutex'

describe('Mutex', () => {
  it('runs holders one after another in arrival order', async () => {
    const mutex = new Mutex()
    const order: number[] = []
    const hold = (n: number) =>
      mutex.runExclusive(async () => {
        order.push(n)
        await new Promise((r) => setTimeout(r, 5))
        order.push(n)
      })

    await Promise.all([hold(1), hold(2), hold(3)])

    expect(order).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('tryAcquire takes a free mutex in the calling tick', () => {
    const mutex = new Mutex()

    const release = mutex.tryAcquire()

    expect(release).not.toBeNull()
    expect(mutex.tryAcquire()).toBeNull()
    release!()
    expect(mutex.tryAcquire()).not.toBeNull()
  })

  it('tryAcquire refuses while a released lock still has a waiter to resume', async () => {
    const mutex = new Mutex()
    const first = mutex.tryAcquire()!
    const waiter = mutex.acquire()

    first()

    expect(mutex.tryAcquire()).toBeNull()
    const second = await waiter
    second()
    expect(mutex.tryAcquire()).not.toBeNull()
  })

  it('ignores a second call to the same release', async () => {
    const mutex = new Mutex()
    const first = mutex.tryAcquire()!
    const waiter = mutex.acquire()

    first()
    first()

    const second = await waiter
    expect(mutex.tryAcquire()).toBeNull()
    second()
  })
})
