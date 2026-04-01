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
})
