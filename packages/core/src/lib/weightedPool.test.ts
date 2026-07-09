import { createWeightedPool } from './weightedPool'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('createWeightedPool', () => {
  it('runs small items together under the budget, holding the overflow', async () => {
    const pool = createWeightedPool({ budget: 100, maxConcurrent: 10, defaultCost: 10 })
    const gates = [deferred(), deferred(), deferred()]
    const running: number[] = []
    const all = Promise.all(
      [40, 40, 40].map((cost, i) =>
        pool.run(cost, async () => {
          running.push(i)
          await gates[i].promise
        }),
      ),
    )
    await tick()
    expect(running).toEqual([0, 1]) // 40+40 fits; the third (120 total) waits
    gates[0].resolve()
    await tick()
    expect(running).toEqual([0, 1, 2]) // freed budget admits it
    gates[1].resolve()
    gates[2].resolve()
    await all
  })

  it('always admits when idle, even over budget, so an oversized item still runs', async () => {
    const pool = createWeightedPool({ budget: 100, maxConcurrent: 4, defaultCost: 10 })
    const result = await pool.run(5_000_000_000, async () => 'ran')
    expect(result).toBe('ran')
  })

  it('the slot cap binds even when the budget has room', async () => {
    const pool = createWeightedPool({ budget: 1_000, maxConcurrent: 2, defaultCost: 10 })
    const gates = [deferred(), deferred(), deferred()]
    const running: number[] = []
    const all = Promise.all(
      gates.map((g, i) =>
        pool.run(1, async () => {
          running.push(i)
          await g.promise
        }),
      ),
    )
    await tick()
    expect(running).toEqual([0, 1])
    gates[0].resolve()
    await tick()
    expect(running).toEqual([0, 1, 2])
    gates[1].resolve()
    gates[2].resolve()
    await all
  })

  it('charges defaultCost for an unknown cost instead of treating it as free', async () => {
    const pool = createWeightedPool({ budget: 100, maxConcurrent: 10, defaultCost: 60 })
    const gates = [deferred(), deferred()]
    const running: number[] = []
    const all = Promise.all(
      gates.map((g, i) =>
        pool.run(0, async () => {
          running.push(i)
          await g.promise
        }),
      ),
    )
    await tick()
    expect(running).toEqual([0]) // two defaults (120) exceed the budget
    gates[0].resolve()
    await tick()
    expect(running).toEqual([0, 1])
    gates[1].resolve()
    await all
  })

  it('releases the budget when fn throws', async () => {
    const pool = createWeightedPool({ budget: 100, maxConcurrent: 4, defaultCost: 10 })
    await expect(pool.run(80, async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    )
    // A follow-up 80-cost item admits immediately because the failed run released.
    const result = await pool.run(80, async () => 'ok')
    expect(result).toBe('ok')
  })
})
