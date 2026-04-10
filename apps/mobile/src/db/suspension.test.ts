import {
  closeDb,
  DatabaseSuspendedError,
  database,
  db,
  dbInitialized,
  getDbState,
  initializeDB,
  resetDb,
  resumeDb,
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
  it('getAllAsync rejects when suspended', async () => {
    suspendDb()
    await expect(db().getAllAsync('SELECT 1')).rejects.toThrow(DatabaseSuspendedError)
  })

  it('getFirstAsync rejects when suspended', async () => {
    suspendDb()
    await expect(db().getFirstAsync('SELECT 1')).rejects.toThrow(DatabaseSuspendedError)
  })

  it('runAsync rejects when suspended', async () => {
    suspendDb()
    await expect(db().runAsync('CREATE TABLE IF NOT EXISTS test (id TEXT)')).rejects.toThrow(
      DatabaseSuspendedError,
    )
  })

  it('execAsync rejects when suspended', async () => {
    suspendDb()
    await expect(db().execAsync('SELECT 1')).rejects.toThrow(DatabaseSuspendedError)
  })

  it('withTransactionAsync rejects when suspended', async () => {
    suspendDb()
    await expect(db().withTransactionAsync(async () => {})).rejects.toThrow(DatabaseSuspendedError)
  })

  it('queries work normally after resumeDb', async () => {
    suspendDb()
    await expect(db().getAllAsync('SELECT 1 as v')).rejects.toThrow(DatabaseSuspendedError)
    resumeDb()
    const rows = await db().getAllAsync<{ v: number }>('SELECT 1 as v')
    expect(rows).toEqual([{ v: 1 }])
  })

  it('queries also reject in closed state', async () => {
    await closeDb()
    await expect(db().getAllAsync('SELECT 1')).rejects.toThrow(DatabaseSuspendedError)
  })
})

describe('withRecovery during suspension', () => {
  it('does not attempt recovery for DatabaseSuspendedError', async () => {
    const fn = jest.fn().mockRejectedValue(new DatabaseSuspendedError())
    await expect(withRecovery(fn)).rejects.toThrow(DatabaseSuspendedError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

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
})

describe('full suspend/resume cycle', () => {
  it('queries work → suspend → rejected → close → reopen → resume → queries work', async () => {
    const rows1 = await db().getAllAsync<{ v: number }>('SELECT 1 as v')
    expect(rows1).toEqual([{ v: 1 }])

    suspendDb()
    await expect(db().getAllAsync('SELECT 1')).rejects.toThrow(DatabaseSuspendedError)

    await closeDb()
    expect(dbInitialized).toBe(false)

    await initializeDB({ databaseName: ':memory:', reopen: true })
    resumeDb()

    const rows2 = await db().getAllAsync<{ v: number }>('SELECT 2 as v')
    expect(rows2).toEqual([{ v: 2 }])
  })

  it('in-flight query at suspend time completes, then drain resolves', async () => {
    let resolveQuery!: () => void
    jest.spyOn(database, 'getAllAsync').mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveQuery = r
        }) as any,
    )

    const queryPromise = db().getAllAsync('SELECT 1')

    suspendDb()
    await expect(db().getAllAsync('SELECT 2')).rejects.toThrow(DatabaseSuspendedError)

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
