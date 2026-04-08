import { CoalescingQueue } from './coalescingQueue'

describe('CoalescingQueue', () => {
  it('runs a single operation immediately', async () => {
    const queue = new CoalescingQueue()
    let ran = false
    await queue.enqueue(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('serializes sequential operations', async () => {
    const queue = new CoalescingQueue()
    const order: number[] = []
    await queue.enqueue(async () => {
      order.push(1)
    })
    await queue.enqueue(async () => {
      order.push(2)
    })
    expect(order).toEqual([1, 2])
  })

  it('collapses redundant pending operations', async () => {
    const queue = new CoalescingQueue()
    const executed: string[] = []

    let resolveFirst!: () => void
    const firstBlocking = new Promise<void>((r) => {
      resolveFirst = r
    })

    // Start a blocking operation
    const first = queue.enqueue(async () => {
      executed.push('first')
      await firstBlocking
    })

    // Queue several more while first is running — only the last should execute
    const second = queue.enqueue(async () => {
      executed.push('second')
    })
    const third = queue.enqueue(async () => {
      executed.push('third')
    })
    const fourth = queue.enqueue(async () => {
      executed.push('fourth')
    })

    // Unblock the first operation
    resolveFirst()
    await first
    await second
    await third
    await fourth

    expect(executed).toEqual(['first', 'fourth'])
  })

  it('discarded operations resolve without running', async () => {
    const queue = new CoalescingQueue()
    const executed: string[] = []

    let resolveFirst!: () => void
    const firstBlocking = new Promise<void>((r) => {
      resolveFirst = r
    })

    const first = queue.enqueue(async () => {
      executed.push('first')
      await firstBlocking
    })

    // These will be discarded
    const discarded1 = queue.enqueue(async () => {
      executed.push('should-not-run-1')
    })
    const discarded2 = queue.enqueue(async () => {
      executed.push('should-not-run-2')
    })

    // This replaces the above
    const last = queue.enqueue(async () => {
      executed.push('last')
    })

    resolveFirst()

    // All promises should resolve
    await Promise.all([first, discarded1, discarded2, last])

    expect(executed).toEqual(['first', 'last'])
  })

  it('handles errors without breaking the queue', async () => {
    const queue = new CoalescingQueue()
    const executed: string[] = []

    await queue
      .enqueue(async () => {
        executed.push('error')
        throw new Error('test error')
      })
      .catch(() => {})

    await queue.enqueue(async () => {
      executed.push('after-error')
    })

    expect(executed).toEqual(['error', 'after-error'])
  })

  it('new operations after queue drains run immediately', async () => {
    const queue = new CoalescingQueue()
    const executed: string[] = []

    await queue.enqueue(async () => {
      executed.push('first')
    })

    // Queue is now idle
    await queue.enqueue(async () => {
      executed.push('second')
    })

    expect(executed).toEqual(['first', 'second'])
  })
})
