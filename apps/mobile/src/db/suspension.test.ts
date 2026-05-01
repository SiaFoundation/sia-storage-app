import {
  closeDb,
  DatabaseSuspendedError,
  database,
  db,
  dbInitialized,
  getActiveJournalMode,
  getDbState,
  initializeDB,
  resetDb,
  resumeDb,
  setJournalMode,
  suspendDb,
  waitForQueriesIdle,
  withRecovery,
} from '.'

const NPE_MESSAGE = 'Call to function has been rejected. java.lang.NullPointerException'

beforeEach(async () => {
  await initializeDB({ databaseName: ':memory:' })
})

afterEach(async () => {
  await resetDb()
})

describe('state transitions', () => {
  it('starts in active state', () => {
    expect(getDbState()).toBe('active')
  })

  it('suspendDb transitions to suspending', () => {
    suspendDb()
    expect(getDbState()).toBe('suspending')
  })

  it('resumeDb transitions back to active', () => {
    suspendDb()
    resumeDb()
    expect(getDbState()).toBe('active')
  })

  it('closeDb transitions to closed', async () => {
    await closeDb()
    expect(getDbState()).toBe('closed')
  })

  it('full cycle: active → suspending → closed → active', async () => {
    expect(getDbState()).toBe('active')
    suspendDb()
    expect(getDbState()).toBe('suspending')
    await closeDb()
    expect(getDbState()).toBe('closed')
    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()
    expect(getDbState()).toBe('active')
  })
})

describe('query gating', () => {
  it('getAllAsync rejects during suspending', async () => {
    suspendDb()
    await expect(db().getAllAsync<{ v: number }>('SELECT 1 as v')).rejects.toThrow(
      DatabaseSuspendedError,
    )
  })

  it('getFirstAsync rejects during suspending', async () => {
    suspendDb()
    await expect(db().getFirstAsync<{ v: number }>('SELECT 1 as v')).rejects.toThrow(
      DatabaseSuspendedError,
    )
  })

  it('runAsync parks during suspending and resolves after resume', async () => {
    suspendDb()
    const queryPromise = db().runAsync('CREATE TABLE IF NOT EXISTS test (id TEXT)')
    let settled = false
    queryPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    resumeDb()
    await queryPromise
  })

  it('execAsync parks during suspending and resolves after resume', async () => {
    suspendDb()
    const queryPromise = db().execAsync('SELECT 1')
    let settled = false
    queryPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    resumeDb()
    await queryPromise
  })

  it('withTransactionAsync parks during suspending and resolves after resume', async () => {
    suspendDb()
    let txRan = false
    const queryPromise = db().withTransactionAsync(async () => {
      txRan = true
    })
    let settled = false
    queryPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(txRan).toBe(false)
    resumeDb()
    await queryPromise
    expect(txRan).toBe(true)
  })

  it('reads also park in closed state and drain after reopen+resume', async () => {
    await closeDb()
    const queryPromise = db().getAllAsync<{ v: number }>('SELECT 1 as v')
    let settled = false
    queryPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()
    const rows = await queryPromise
    expect(rows).toEqual([{ v: 1 }])
  })

  it('writes park in closed state and drain after reopen+resume', async () => {
    await closeDb()
    const queryPromise = db().runAsync('CREATE TABLE IF NOT EXISTS t (id TEXT)')
    let settled = false
    queryPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()
    await queryPromise
  })

  it('parked write rejects with DatabaseSuspendedError after wait timeout', async () => {
    jest.useFakeTimers()
    try {
      suspendDb()
      const queryPromise = db().runAsync('SELECT 1')
      queryPromise.catch(() => {})
      jest.advanceTimersByTime(30_000)
      await expect(queryPromise).rejects.toThrow(DatabaseSuspendedError)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('withRecovery during suspension', () => {
  it('does not reopen when state is suspending', async () => {
    suspendDb()
    const fn = jest.fn().mockRejectedValue(new Error(NPE_MESSAGE))
    await expect(withRecovery(fn)).rejects.toThrow(NPE_MESSAGE)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not reopen when state is closed', async () => {
    await closeDb()
    const fn = jest.fn().mockRejectedValue(new Error(NPE_MESSAGE))
    await expect(withRecovery(fn)).rejects.toThrow(NPE_MESSAGE)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still recovers from NPE in active state', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error(NPE_MESSAGE))
      .mockResolvedValueOnce('recovered')
    const result = await withRecovery(fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('in-flight tracking', () => {
  it('waitForQueriesIdle resolves immediately with no in-flight queries', async () => {
    await waitForQueriesIdle()
  })

  it('waitForQueriesIdle waits for an in-flight query to complete', async () => {
    let resolveQuery!: () => void
    const blockingPromise = new Promise<void>((r) => {
      resolveQuery = r
    })
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(() => blockingPromise as any)

    const queryPromise = db().getAllAsync('SELECT 1')

    let idleDone = false
    const idlePromise = waitForQueriesIdle().then(() => {
      idleDone = true
    })

    await Promise.resolve()
    expect(idleDone).toBe(false)

    resolveQuery()
    await queryPromise
    await idlePromise
    expect(idleDone).toBe(true)
  })

  it('waitForQueriesIdle waits for multiple in-flight queries', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    jest
      .spyOn(database, 'getAllAsync')
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveFirst = r
          }) as any,
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveSecond = r
          }) as any,
      )

    const q1 = db().getAllAsync('SELECT 1')
    const q2 = db().getAllAsync('SELECT 2')

    let idleDone = false
    const idlePromise = waitForQueriesIdle().then(() => {
      idleDone = true
    })

    resolveFirst()
    await q1
    await Promise.resolve()
    expect(idleDone).toBe(false)

    resolveSecond()
    await q2
    await idlePromise
    expect(idleDone).toBe(true)
  })

  it('counter resets to 0 on resumeDb', async () => {
    let resolveQuery!: () => void
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveQuery = r
        }) as any,
    )

    db().getAllAsync('SELECT 1')
    resumeDb()
    await waitForQueriesIdle()
    resolveQuery()
  })
})

describe('closeDb', () => {
  it('sets dbInitialized to false before closing', async () => {
    expect(dbInitialized).toBe(true)
    const closeSpy = jest.spyOn(database, 'closeAsync')
    let initDuringClose: boolean | undefined
    closeSpy.mockImplementationOnce(async () => {
      initDuringClose = dbInitialized
    })
    await closeDb()
    expect(initDuringClose).toBe(false)
  })

  it('runs WAL checkpoint before close', async () => {
    const execSpy = jest.spyOn(database, 'execAsync')
    await closeDb()
    const calls = execSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('PRAGMA busy_timeout = 0')
    expect(calls).toContain('PRAGMA wal_checkpoint(TRUNCATE)')
  })

  it('succeeds even if checkpoint fails', async () => {
    const execSpy = jest.spyOn(database, 'execAsync')
    execSpy.mockRejectedValue(new Error('checkpoint failed'))
    await closeDb()
    expect(getDbState()).toBe('closed')
  })

  it('succeeds even if closeAsync throws', async () => {
    jest.spyOn(database, 'closeAsync').mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await closeDb()
    expect(dbInitialized).toBe(false)
    expect(getDbState()).toBe('closed')
  })

  // Closing while a query iterates the native handle produces a UAF in
  // sqlite3_mutex_enter (TestFlight crash #29). closeDb must wait for the
  // serial dispatch queue to be empty before destroying the handle.
  it('waits for in-flight queries to finish before closeAsync', async () => {
    let resolveQuery!: () => void
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveQuery = r
        }) as any,
    )
    const closeAsyncSpy = jest.spyOn(database, 'closeAsync')

    const queryPromise = db().getAllAsync('SELECT 1')

    let closeDone = false
    const closePromise = closeDb().then(() => {
      closeDone = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(closeDone).toBe(false)
    expect(closeAsyncSpy).not.toHaveBeenCalled()

    resolveQuery()
    await queryPromise
    await closePromise
    expect(closeDone).toBe(true)
    expect(closeAsyncSpy).toHaveBeenCalled()
  })
})

describe('full suspend/resume cycle', () => {
  it('reads during suspending reject; reads during closed park and drain after reopen', async () => {
    const rows1 = await db().getAllAsync<{ v: number }>('SELECT 1 as v')
    expect(rows1).toEqual([{ v: 1 }])

    suspendDb()
    await expect(db().getAllAsync<{ v: number }>('SELECT 1 as v')).rejects.toThrow(
      DatabaseSuspendedError,
    )

    await closeDb()
    expect(dbInitialized).toBe(false)
    const duringClosed = db().getAllAsync<{ v: number }>('SELECT 2 as v')

    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()

    expect(await duringClosed).toEqual([{ v: 2 }])
  })

  it('writes during suspending park and resolve after resume; native callback continuations preserved', async () => {
    suspendDb()
    const writeDuringSuspend = db().runAsync('CREATE TABLE IF NOT EXISTS t (id TEXT)')
    let settled = false
    writeDuringSuspend.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    resumeDb()
    await writeDuringSuspend
  })

  it('in-flight query at suspend time completes, then drain resolves', async () => {
    let resolveQuery!: () => void
    jest.spyOn(database, 'runAsync').mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveQuery = r
        }) as any,
    )

    const queryPromise = db().runAsync('CREATE TABLE IF NOT EXISTS x (id TEXT)')

    suspendDb()
    // A new write issued during suspend parks; it does not count toward inflight.
    const parked = db().runAsync('CREATE TABLE IF NOT EXISTS y (id TEXT)')
    let parkedSettled = false
    parked.then(() => {
      parkedSettled = true
    })
    await Promise.resolve()
    expect(parkedSettled).toBe(false)

    let drained = false
    waitForQueriesIdle().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    resolveQuery()
    await queryPromise
    await Promise.resolve()
    expect(drained).toBe(true)

    resumeDb()
    await parked
  })

  it('resetDb works after suspend → resume → reinit sequence', async () => {
    // Simulate: boot → suspend → resume (reopen) → full reinit → reset.
    // This is the exact sequence that happens when the app suspends during
    // initial auth, resumes, then the full init completes. Without closing
    // the previous connection in initializeDB, the intermediate reopen
    // connection leaks and deleteDatabaseAsync fails.
    suspendDb()
    await closeDb()

    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()

    // Full reinit (as if the app's init flow completed after resume).
    await initializeDB({ databaseName: ':memory:' })

    // Reset should not throw.
    await resetDb()
    expect(dbInitialized).toBe(true)
    expect(getDbState()).toBe('active')
  })

  it('rapid suspend/resume does not corrupt state', async () => {
    suspendDb()
    resumeDb()
    suspendDb()
    resumeDb()
    expect(getDbState()).toBe('active')

    const rows = await db().getAllAsync<{ v: number }>('SELECT 1 as v')
    expect(rows).toEqual([{ v: 1 }])
  })
})

describe('journal mode', () => {
  afterEach(() => {
    setJournalMode('DELETE')
  })

  it('defaults to DELETE', () => {
    expect(getActiveJournalMode()).toBe('DELETE')
  })

  it('round-trips through setJournalMode', () => {
    setJournalMode('WAL')
    expect(getActiveJournalMode()).toBe('WAL')
    setJournalMode('DELETE')
    expect(getActiveJournalMode()).toBe('DELETE')
  })

  it('initializeDB applies the DELETE pragma when mode is DELETE', async () => {
    setJournalMode('DELETE')
    await initializeDB({ databaseName: ':memory:' })
    const row = await db().getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode')
    // :memory: forces 'memory' regardless, so assert the pragma at least
    // executed by also checking auto_checkpoint is at the SQLite default
    // (1000 pages) rather than the WAL-tuned 500.
    expect(row?.journal_mode).toBeDefined()
    const auto = await db().getFirstAsync<{ wal_autocheckpoint: number }>(
      'PRAGMA wal_autocheckpoint',
    )
    expect(auto?.wal_autocheckpoint).toBe(1000)
  })

  it('initializeDB applies the WAL pragma when mode is WAL', async () => {
    setJournalMode('WAL')
    await initializeDB({ databaseName: ':memory:' })
    const auto = await db().getFirstAsync<{ wal_autocheckpoint: number }>(
      'PRAGMA wal_autocheckpoint',
    )
    expect(auto?.wal_autocheckpoint).toBe(500)
  })
})
