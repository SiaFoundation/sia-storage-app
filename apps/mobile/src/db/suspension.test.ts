import { DatabaseSuspendedError } from '@siastorage/core/lib/errors'
import { createSuspensionManager } from '@siastorage/core/services/suspension'
import {
  database,
  db,
  dbInitialized,
  endOpenTransaction,
  getDbState,
  getInflightCount,
  initializeDB,
  interruptDatabase,
  isInTransaction,
  resetDb,
  resumeDb,
  suspendBlocker,
  suspendDb,
  waitForQueriesIdle,
  withRecovery,
} from '.'

const NPE_MESSAGE = 'Call to function has been rejected. java.lang.NullPointerException'

beforeEach(async () => {
  await initializeDB({ databaseName: ':memory:' })
  await db().execAsync('CREATE TABLE t (x INTEGER)')
})

afterEach(async () => {
  resumeDb()
  await resetDb()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  p.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  for (let i = 0; i < 10; i++) await Promise.resolve()
  return done
}

const rows = async () => (await db().getAllAsync<{ x: number }>('SELECT x FROM t')).map((r) => r.x)

describe('gate states', () => {
  it('starts active, suspends and resumes', () => {
    expect(getDbState()).toBe('active')
    suspendDb()
    expect(getDbState()).toBe('suspending')
    resumeDb()
    expect(getDbState()).toBe('active')
  })
})

describe('while suspending', () => {
  it('parks an outer statement and runs it after resume', async () => {
    suspendDb()
    const write = db().runAsync('INSERT INTO t VALUES (1)')

    expect(await settled(write)).toBe(false)
    resumeDb()
    await write

    expect(await rows()).toEqual([1])
  })

  it('parks a transaction before BEGIN and runs it after resume', async () => {
    suspendDb()
    let began = false
    const txn = db().withTransactionAsync(async (tx) => {
      began = true
      await tx.runAsync('INSERT INTO t VALUES (1)')
    })

    expect(await settled(txn)).toBe(false)
    expect(began).toBe(false)
    resumeDb()
    await txn

    expect(await rows()).toEqual([1])
  })

  it('rejects a parked call once the gate has stayed closed for 30s', async () => {
    jest.useFakeTimers()
    try {
      suspendDb()
      const read = db().getAllAsync('SELECT 1')
      read.catch(() => {})
      jest.advanceTimersByTime(30_000)
      await expect(read).rejects.toThrow(DatabaseSuspendedError)
    } finally {
      jest.useRealTimers()
    }
  })

  it('starts the 30s over when the timer fires late after a freeze', async () => {
    jest.useFakeTimers()
    try {
      suspendDb()
      const read = db().getAllAsync<{ v: number }>('SELECT 1 AS v')
      read.catch(() => {})

      jest.setSystemTime(Date.now() + 60 * 60_000)
      jest.advanceTimersByTime(30_000)
      expect(await settled(read)).toBe(false)

      resumeDb()
      await expect(read).resolves.toEqual([{ v: 1 }])
    } finally {
      jest.useRealTimers()
    }
  })

  it('lets an open transaction commit while suspending until the drain interrupts', async () => {
    const paused = deferred()
    const txn = db().withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (1)')
      await paused.promise
      await tx.runAsync('INSERT INTO t VALUES (2)')
    })
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    paused.resolve()
    await txn

    resumeDb()
    expect(await rows()).toEqual([1, 2])
  })

  it('rejects the next statement of an open transaction once the drain interrupts, and rolls it back', async () => {
    const paused = deferred()
    const txn = db().withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (1)')
      await paused.promise
      await tx.runAsync('INSERT INTO t VALUES (2)')
    })
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    interruptDatabase()
    paused.resolve()

    await expect(txn).rejects.toThrow(DatabaseSuspendedError)
    await waitForQueriesIdle()
    expect(isInTransaction()).toBe(false)
    resumeDb()
    expect(await rows()).toEqual([])
  })

  it('reports a suspension when the drain interrupts a statement mid-transaction', async () => {
    const running = deferred()
    jest.spyOn(database, 'runAsync').mockImplementationOnce(async () => {
      await running.promise
      throw new Error('interrupted')
    })
    const txn = db().withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (1)')
    })
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    interruptDatabase()
    running.resolve()

    await expect(txn).rejects.toThrow(DatabaseSuspendedError)
  })

  it('reports a suspension when the drain interrupts a statement outside a transaction', async () => {
    const running = deferred()
    jest.spyOn(database, 'runAsync').mockImplementationOnce(async () => {
      await running.promise
      throw new Error('interrupted')
    })
    const write = db().runAsync('INSERT INTO t VALUES (1)')
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    interruptDatabase()
    running.resolve()

    await expect(write).rejects.toThrow(DatabaseSuspendedError)
  })

  it('rolls back a transaction left open after the drain', async () => {
    await database.execAsync('BEGIN')
    expect(await endOpenTransaction()).toBe(true)
    expect(isInTransaction()).toBe(false)
    expect(await endOpenTransaction()).toBe(false)
  })

  it('rejects calls through failFast instead of parking', async () => {
    suspendDb()
    const fast = db().failFast!()

    await expect(fast.runAsync('INSERT INTO t VALUES (1)')).rejects.toThrow(DatabaseSuspendedError)
    await expect(fast.withTransactionAsync(async () => {})).rejects.toThrow(DatabaseSuspendedError)
  })
})

describe('in-flight tracking', () => {
  it('counts a statement made while active before the caller yields', async () => {
    const write = db().runAsync('INSERT INTO t VALUES (1)')

    expect(getInflightCount()).toBe(1)
    suspendDb()
    await waitForQueriesIdle()
    expect(await settled(write)).toBe(true)
  })

  it('counts a transaction made while active before the caller yields', async () => {
    const txn = db().withTransactionAsync(async () => {})

    expect(getInflightCount()).toBe(1)
    await txn
  })

  it('does not count transactions waiting for the lock', async () => {
    const held = deferred()
    const first = db().withTransactionAsync(() => held.promise)
    const queued = Array.from({ length: 50 }, () => db().withTransactionAsync(async () => {}))
    await new Promise((r) => setTimeout(r, 10))

    expect(getInflightCount()).toBe(1)
    held.resolve()
    await Promise.all([first, ...queued])
    expect(getInflightCount()).toBe(0)
  })

  it('parks a transaction that gets the lock after the gate closed, and drains without it', async () => {
    const held = deferred()
    const first = db().withTransactionAsync(() => held.promise)
    let secondBegan = false
    const second = db().withTransactionAsync(async (tx) => {
      secondBegan = true
      await tx.runAsync('INSERT INTO t VALUES (2)')
    })
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    held.resolve()
    await first
    await waitForQueriesIdle()

    expect(secondBegan).toBe(false)
    resumeDb()
    await second
    expect(await rows()).toEqual([2])
  })

  it('waits for the drain on a statement still running when the gate closes', async () => {
    const running = deferred()
    jest.spyOn(database, 'runAsync').mockImplementationOnce(() => running.promise as any)
    const write = db().runAsync('INSERT INTO t VALUES (1)')

    suspendDb()
    const drained = waitForQueriesIdle()
    expect(await settled(drained)).toBe(false)

    running.resolve()
    await write
    await drained
  })

  it('keeps the count across resume so a late end cannot drive it negative', async () => {
    const running = deferred()
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(() => running.promise as any)
    const read = db().getAllAsync('SELECT 1')
    resumeDb()

    const idle = waitForQueriesIdle()
    expect(await settled(idle)).toBe(false)
    running.resolve()
    await read
    await idle
    expect(getInflightCount()).toBe(0)
  })
})

describe('outer statements and transactions', () => {
  it('begins a transaction only after an outer statement already running has settled', async () => {
    const running = deferred()
    jest.spyOn(database, 'runAsync').mockImplementationOnce(() => running.promise as any)
    const begin = jest.spyOn(database, 'withTransactionAsync')
    const write = db().runAsync('INSERT INTO t VALUES (1)')
    const txn = db().withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (2)')
    })

    expect(await settled(txn)).toBe(false)
    expect(begin).not.toHaveBeenCalled()
    running.resolve()
    await write
    await txn
    expect(begin).toHaveBeenCalledTimes(1)
  })

  it('keeps an outer write out of a transaction that rolls back', async () => {
    const paused = deferred()
    const failing = db()
      .withTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO t VALUES (1)')
        await paused.promise
        throw new Error('batch failed')
      })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 10))

    const outer = db().runAsync('INSERT INTO t VALUES (2)')
    paused.resolve()
    await Promise.all([outer, failing])

    expect(await rows()).toEqual([2])
  })

  it('closes its handle, nested transactions included, when the body ends', async () => {
    let kept:
      | Parameters<Parameters<ReturnType<typeof db>['withTransactionAsync']>[0]>[0]
      | undefined
    await db().withTransactionAsync(async (tx) => {
      kept = tx
    })

    await expect(kept?.runAsync('INSERT INTO t VALUES (1)')).rejects.toThrow('has ended')
    await expect(kept?.withTransactionAsync(async () => {})).rejects.toThrow('has ended')
  })

  it('joins a nested transaction opened through the handle', async () => {
    await db()
      .withTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO t VALUES (1)')
        await tx.withTransactionAsync(async (inner) => {
          await inner.runAsync('INSERT INTO t VALUES (2)')
          throw new Error('nested op failed')
        })
      })
      .catch(() => {})

    expect(await rows()).toEqual([])
  })
})

describe('resetDb', () => {
  it('parks calls made during the reset and runs them on the new database', async () => {
    const reset = resetDb()
    expect(getDbState()).toBe('closed')
    const read = db().getAllAsync<{ n: number }>(
      `SELECT count(*) AS n FROM sqlite_master WHERE name = 't'`,
    )

    await reset
    expect(getDbState()).toBe('active')
    expect(dbInitialized).toBe(true)
    expect(await read).toEqual([{ n: 0 }])
  })

  it('holds the drain open through a reset and leaves the gate closed for a suspend that lands mid-reset', async () => {
    const closing = deferred()
    jest.spyOn(database, 'closeAsync').mockImplementationOnce(() => closing.promise)
    const reset = resetDb()
    await new Promise((r) => setTimeout(r, 10))

    suspendDb()
    const drained = waitForQueriesIdle()
    expect(await settled(drained)).toBe(false)

    closing.resolve()
    await reset
    await drained
    expect(getDbState()).toBe('suspending')
  })

  it('holds the drain open for a reset still waiting for the writer lock', async () => {
    const held = deferred()
    const txn = db().withTransactionAsync(() => held.promise)
    await new Promise((r) => setTimeout(r, 10))
    const reset = resetDb()

    suspendDb()
    const drained = waitForQueriesIdle()
    held.resolve()
    await txn
    expect(await settled(drained)).toBe(false)

    await reset
    await drained
  })

  it('waits for a running statement before closing the connection', async () => {
    const running = deferred()
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(() => running.promise as any)
    const close = jest.spyOn(database, 'closeAsync')
    const read = db().getAllAsync('SELECT 1')

    const reset = resetDb()
    expect(await settled(reset)).toBe(false)
    expect(close).not.toHaveBeenCalled()

    running.resolve()
    await read
    await reset
    expect(close).toHaveBeenCalled()
  })
})

describe('withRecovery', () => {
  it('does not reopen while suspending', async () => {
    suspendDb()
    const fn = jest.fn().mockRejectedValue(new Error(NPE_MESSAGE))
    await expect(withRecovery(fn)).rejects.toThrow(NPE_MESSAGE)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recovers from a native handle error while active', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error(NPE_MESSAGE))
      .mockResolvedValueOnce('recovered')
    expect(await withRecovery(fn)).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('journal mode', () => {
  it('opens with a 500-page autocheckpoint and a 4MB WAL size limit', async () => {
    const auto = await db().getFirstAsync<{ wal_autocheckpoint: number }>(
      'PRAGMA wal_autocheckpoint',
    )
    expect(auto?.wal_autocheckpoint).toBe(500)
    const limit = await db().getFirstAsync<{ journal_size_limit: number }>(
      'PRAGMA journal_size_limit',
    )
    expect(limit?.journal_size_limit).toBe(4194304)
  })
})

describe('suspension manager', () => {
  function manager() {
    return createSuspensionManager({
      scheduler: { pause() {}, abort() {}, resume() {} },
      uploader: { suspend() {}, resume() {}, adjustBatchForSuspension() {} },
      db: {
        gate: suspendDb,
        ungate: resumeDb,
        waitForIdle: waitForQueriesIdle,
        interrupt: interruptDatabase,
        getInflightCount,
        endOpenTransaction,
      },
      platform: { getBackgroundTimeRemainingMs: () => Number.POSITIVE_INFINITY },
      hooks: { suspendBlocker },
    })
  }

  it('suspends during a reset and finishes suspending only after the reset', async () => {
    const held = deferred()
    const txn = db().withTransactionAsync(() => held.promise)
    await new Promise((r) => setTimeout(r, 10))
    const order: string[] = []
    const reset = resetDb().then(() => order.push('reset'))

    const suspended = manager()
      .suspend()
      .then(() => order.push('suspended'))
    held.resolve()
    await Promise.all([txn, reset, suspended])

    expect(order).toEqual(['reset', 'suspended'])
    expect(getDbState()).toBe('suspending')
  })

  it('suspends rather than declining when backgrounded while a reset replaces the connection', async () => {
    const closing = deferred()
    jest.spyOn(database, 'closeAsync').mockImplementationOnce(() => closing.promise)
    const reset = resetDb()
    await new Promise((r) => setTimeout(r, 10))

    const suspended = manager().suspend()
    closing.resolve()
    await Promise.all([reset, suspended])

    expect(getDbState()).toBe('suspending')
  })
})
