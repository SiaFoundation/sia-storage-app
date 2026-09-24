import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSuspendedError } from '@siastorage/core/lib/errors'
import * as SQLite from 'expo-sqlite'
import {
  database,
  db,
  getInflightCount,
  initializeDB,
  resetDb,
  resumeDb,
  suspendDb,
  waitForQueriesIdle,
} from '.'

/*
 * expo-sqlite-mock opens every connection on EXPO_SQLITE_MOCK, or on its own
 * `:memory:` database when unset. Pointing it at a file gives the readers the
 * writer's database, as on a device.
 */
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-pool-'))
  process.env.EXPO_SQLITE_MOCK = path.join(dir, 'app.db')
})

afterAll(() => {
  delete process.env.EXPO_SQLITE_MOCK
  fs.rmSync(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await initializeDB({ databaseName: 'app.db' })
  await db().execAsync('DROP TABLE IF EXISTS t; CREATE TABLE t (x INTEGER)')
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

const rows = async () => (await db().getAllAsync<{ x: number }>('SELECT x FROM t')).map((r) => r.x)

describe('read pool', () => {
  it('runs outer reads off the writer', async () => {
    const onWriter = jest.spyOn(database, 'getAllAsync')

    await rows()

    expect(onWriter).not.toHaveBeenCalled()
  })

  it('reads the last commit while a transaction is open, without waiting for it', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    const paused = deferred()
    const txn = db().withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (2)')
      await paused.promise
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(await rows()).toEqual([1])

    paused.resolve()
    await txn
    expect(await rows()).toEqual([1, 2])
  })

  it('refuses a write sent through a read method', async () => {
    await expect(db().getAllAsync('INSERT INTO t VALUES (1) RETURNING x')).rejects.toThrow(
      /readonly/i,
    )
    expect(await rows()).toEqual([])
  })

  it('reopens the pool after a reset', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    await resetDb()
    await db().execAsync('DROP TABLE IF EXISTS t; CREATE TABLE t (x INTEGER)')
    const onWriter = jest.spyOn(database, 'getAllAsync')

    expect(await rows()).toEqual([])
    expect(onWriter).not.toHaveBeenCalled()
  })

  it('counts a read on a reader in flight until it settles', async () => {
    const read = rows()

    expect(getInflightCount()).toBe(1)
    suspendDb()
    await waitForQueriesIdle()
    expect(await read).toEqual([])
  })

  it('parks a read made while suspending and runs it after resume', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    suspendDb()
    const read = rows()
    let done = false
    void read.then(() => {
      done = true
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(done).toBe(false)
    resumeDb()
    expect(await read).toEqual([1])
  })

  it('rejects a read through failFast while suspending', async () => {
    suspendDb()

    await expect(db().failFast!().getAllAsync('SELECT x FROM t')).rejects.toThrow(
      DatabaseSuspendedError,
    )
  })

  it('retires a reader whose native handle died and retries the read once', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    const reads = jest
      .spyOn(SQLite.SQLiteDatabase.prototype, 'getAllAsync')
      .mockRejectedValueOnce(
        new Error('Call to function has been rejected. java.lang.NullPointerException'),
      )

    const close = jest.spyOn(SQLite.SQLiteDatabase.prototype, 'closeAsync')

    expect(await rows()).toEqual([1])
    expect(reads).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await rows()).toEqual([1])
  })

  it("holds the drain open until a retired reader's close finishes", async () => {
    jest
      .spyOn(SQLite.SQLiteDatabase.prototype, 'getAllAsync')
      .mockRejectedValueOnce(
        new Error('Call to function has been rejected. java.lang.NullPointerException'),
      )
    const closing = deferred()
    jest
      .spyOn(SQLite.SQLiteDatabase.prototype, 'closeAsync')
      .mockImplementationOnce(() => closing.promise)
    await rows()

    suspendDb()
    let drained = false
    const drain = waitForQueriesIdle().then(() => {
      drained = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(drained).toBe(false)

    closing.resolve()
    await drain
  })

  it('runs a read the gate interrupted again after resume instead of failing it', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    const running = deferred()
    let interrupted!: (e: Error) => void
    jest.spyOn(SQLite.SQLiteDatabase.prototype, 'getAllAsync').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          interrupted = reject
          running.resolve()
        }),
    )
    const read = rows()
    await running.promise

    suspendDb()
    interrupted(new Error('interrupted'))
    await waitForQueriesIdle()
    let done = false
    void read.then(() => {
      done = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)

    resumeDb()
    expect(await read).toEqual([1])
  })

  it('gives each reader one read at a time, so a read made after a commit sees it', async () => {
    const held = [deferred(), deferred()]
    const real = SQLite.SQLiteDatabase.prototype.getAllAsync
    const reads = jest.spyOn(SQLite.SQLiteDatabase.prototype, 'getAllAsync')
    reads.mockClear()
    for (const h of held) {
      reads.mockImplementationOnce(async function (this: SQLite.SQLiteDatabase, ...args: any[]) {
        await h.promise
        return real.apply(this, args as [string])
      })
    }
    const busy = [rows(), rows()]
    await new Promise((r) => setTimeout(r, 10))
    await db().runAsync('INSERT INTO t VALUES (1)')

    const after = rows()
    await new Promise((r) => setTimeout(r, 10))
    expect(reads).toHaveBeenCalledTimes(2)

    held[0].resolve()
    expect(await after).toEqual([1])
    held[1].resolve()
    await Promise.all(busy)
  })

  it('runs a read again however many suspensions cut it off', async () => {
    await db().runAsync('INSERT INTO t VALUES (1)')
    const started = [deferred(), deferred()]
    const cuts: Array<(e: Error) => void> = []
    const reads = jest.spyOn(SQLite.SQLiteDatabase.prototype, 'getAllAsync')
    for (const s of started) {
      reads.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            cuts.push(reject)
            s.resolve()
          }),
      )
    }
    const read = rows()

    // The gate reopens before each rejection reaches the read.
    for (const s of started) {
      await s.promise
      suspendDb()
      resumeDb()
      cuts.shift()!(new Error('interrupted'))
    }

    expect(await read).toEqual([1])
  })
})
