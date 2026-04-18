import { SlotPool } from './slotPool'

describe('SlotPool', () => {
  describe('acquire with signal', () => {
    it('grants a slot immediately when available', async () => {
      const pool = new SlotPool(2)
      const controller = new AbortController()
      const release = await pool.acquire(controller.signal)
      expect(pool.getInUseCount()).toBe(1)
      release()
      expect(pool.getInUseCount()).toBe(0)
    })

    it('rejects immediately if signal is already aborted', async () => {
      const pool = new SlotPool(1)
      const controller = new AbortController()
      controller.abort()
      await expect(pool.acquire(controller.signal)).rejects.toThrow('The operation was aborted.')
      expect(pool.getInUseCount()).toBe(0)
      expect(pool.getQueueSize()).toBe(0)
    })

    it('removes waiter from queue when signal aborts', async () => {
      const pool = new SlotPool(1)
      // Fill the only slot.
      const release1 = await pool.acquire()
      expect(pool.getInUseCount()).toBe(1)

      const controller = new AbortController()
      const promise = pool.acquire(controller.signal)
      expect(pool.getQueueSize()).toBe(1)

      // Abort while queued.
      controller.abort()
      await expect(promise).rejects.toThrow('The operation was aborted.')
      expect(pool.getQueueSize()).toBe(0)

      // The slot is still held by release1, not consumed by the aborted waiter.
      expect(pool.getInUseCount()).toBe(1)
      release1()
      expect(pool.getInUseCount()).toBe(0)
    })

    it('does not double-grant if abort fires after slot is granted', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const controller = new AbortController()
      const promise = pool.acquire(controller.signal)
      expect(pool.getQueueSize()).toBe(1)

      // Release the slot — the queued waiter should be granted.
      release1()
      const release2 = await promise
      expect(pool.getInUseCount()).toBe(1)

      // Aborting after grant should have no effect.
      controller.abort()
      expect(pool.getInUseCount()).toBe(1)
      expect(pool.getQueueSize()).toBe(0)

      release2()
      expect(pool.getInUseCount()).toBe(0)
    })

    it('allows next waiter to proceed when earlier waiter aborts', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const controller1 = new AbortController()
      const promise1 = pool.acquire(controller1.signal)

      const controller2 = new AbortController()
      const promise2 = pool.acquire(controller2.signal)

      expect(pool.getQueueSize()).toBe(2)

      // Abort the first waiter.
      controller1.abort()
      await expect(promise1).rejects.toThrow('The operation was aborted.')
      expect(pool.getQueueSize()).toBe(1)

      // Release the slot — the second waiter should get it.
      release1()
      const release2 = await promise2
      expect(pool.getInUseCount()).toBe(1)
      release2()
    })
  })

  describe('acquire with priority', () => {
    it('grants a slot immediately when available', async () => {
      const pool = new SlotPool(2)
      const controller = new AbortController()
      const release = await pool.acquire(controller.signal, { priority: 0 })
      expect(pool.getInUseCount()).toBe(1)
      release()
      expect(pool.getInUseCount()).toBe(0)
    })

    it('rejects immediately if signal is already aborted', async () => {
      const pool = new SlotPool(1)
      const controller = new AbortController()
      controller.abort()
      await expect(pool.acquire(controller.signal, { priority: 0 })).rejects.toThrow(
        'The operation was aborted.',
      )
      expect(pool.getInUseCount()).toBe(0)
      expect(pool.getQueueSize()).toBe(0)
    })

    it('serves P0 before P1', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()
      const order: number[] = []

      const c1 = new AbortController()
      void pool.acquire(c1.signal, { priority: 1 }).then((r) => {
        order.push(1)
        r()
      })

      const c2 = new AbortController()
      void pool.acquire(c2.signal, { priority: 0 }).then((r) => {
        order.push(0)
        r()
      })

      expect(pool.getQueueSize()).toBe(2)
      release1()

      // Let microtasks resolve — both grants should fire.
      await new Promise((r) => setTimeout(r, 0))
      expect(order).toEqual([0, 1])
    })

    it('is LIFO within the same priority', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()
      const order: string[] = []

      const c1 = new AbortController()
      void pool.acquire(c1.signal, { priority: 1 }).then((r) => {
        order.push('first')
        r()
      })

      const c2 = new AbortController()
      void pool.acquire(c2.signal, { priority: 1 }).then((r) => {
        order.push('second')
        r()
      })

      release1()
      await new Promise((r) => setTimeout(r, 0))

      // Newest (second) should be served first.
      expect(order).toEqual(['second', 'first'])
    })

    it('evicts oldest entries when maxQueueDepth is exceeded', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const evicted: string[] = []
      const controllers: AbortController[] = []

      // Queue 3 entries with maxQueueDepth=2.
      for (let i = 0; i < 3; i++) {
        const c = new AbortController()
        controllers.push(c)
        pool.acquire(c.signal, { priority: 1, maxQueueDepth: 2 }).catch(() => {
          evicted.push(`entry-${i}`)
        })
      }

      // The first entry (oldest) should have been evicted.
      await new Promise((r) => setTimeout(r, 0))
      expect(evicted).toEqual(['entry-0'])
      expect(pool.getQueueSize()).toBe(2)

      release1()
    })

    it('does not evict entries of a different priority', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const c0 = new AbortController()
      void pool.acquire(c0.signal, { priority: 0 })

      // Queue 3 P1 entries with maxQueueDepth=2.
      for (let i = 0; i < 3; i++) {
        const c = new AbortController()
        pool.acquire(c.signal, { priority: 1, maxQueueDepth: 2 }).catch(() => {})
      }

      await new Promise((r) => setTimeout(r, 0))

      // 1 P0 + 2 P1 (1 P1 evicted).
      expect(pool.getQueueSize()).toBe(3)
      release1()
    })

    it('signal abort removes entry from queue', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const c1 = new AbortController()
      const promise = pool.acquire(c1.signal, { priority: 1 })
      expect(pool.getQueueSize()).toBe(1)

      c1.abort()
      await expect(promise).rejects.toThrow('The operation was aborted.')
      expect(pool.getQueueSize()).toBe(0)

      release1()
    })

    it('does not double-grant if abort fires after slot is granted', async () => {
      const pool = new SlotPool(1)
      const release1 = await pool.acquire()

      const controller = new AbortController()
      const promise = pool.acquire(controller.signal, { priority: 0 })
      expect(pool.getQueueSize()).toBe(1)

      release1()
      const release2 = await promise
      expect(pool.getInUseCount()).toBe(1)

      controller.abort()
      expect(pool.getInUseCount()).toBe(1)
      expect(pool.getQueueSize()).toBe(0)

      release2()
      expect(pool.getInUseCount()).toBe(0)
    })
  })
})
