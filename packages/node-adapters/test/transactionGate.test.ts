import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import sqlite3 from 'better-sqlite3'
import { createBetterSqlite3Database } from '../src/database'
import { TransactionMisuseError } from '../src/transactionGate'

/*
 * Two flows sharing one connection, as the daemon's services and its IPC
 * handlers do. The pause inside each transaction is the await that lets the
 * other flow in.
 */
const pause = () => new Promise((resolve) => setTimeout(resolve, 10))

async function table() {
  const db = createBetterSqlite3Database()
  await db.execAsync('CREATE TABLE t (x INTEGER)')
  const rows = async () => (await db.getAllAsync<{ x: number }>('SELECT x FROM t')).map((r) => r.x)
  return { db, rows }
}

describe('transactions on a shared connection', () => {
  it('run one after another instead of failing', async () => {
    const { db, rows } = await table()
    const tx = (x: number) =>
      db.withTransactionAsync(async (t) => {
        await t.runAsync('INSERT INTO t VALUES (?)', x)
        await pause()
      })

    await Promise.all([tx(1), tx(2), tx(3)])

    expect((await rows()).sort()).toEqual([1, 2, 3])
  })

  it('keep a statement from another flow out of a transaction that rolls back', async () => {
    const { db, rows } = await table()
    const failing = db
      .withTransactionAsync(async (t) => {
        await t.runAsync('INSERT INTO t VALUES (1)')
        await pause()
        throw new Error('batch failed')
      })
      .catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 2))

    await Promise.all([db.runAsync('INSERT INTO t VALUES (2)'), failing])

    expect(await rows()).toEqual([2])
  })

  it('join a nested transaction opened through the handle, and roll all of it back on a throw', async () => {
    const { db, rows } = await table()

    await db
      .withTransactionAsync(async (t) => {
        await t.runAsync('INSERT INTO t VALUES (1)')
        await t.withTransactionAsync(async (inner) => {
          await inner.runAsync('INSERT INTO t VALUES (2)')
          throw new Error('nested op failed')
        })
      })
      .catch(() => {})

    expect(await rows()).toEqual([])
  })

  it('refuse the outer adapter inside a body instead of waiting on it forever', async () => {
    const { db } = await table()

    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO t VALUES (1)')
      }),
    ).rejects.toThrow(TransactionMisuseError)
    await expect(
      db.withTransactionAsync(() => db.withTransactionAsync(async () => {})),
    ).rejects.toThrow(TransactionMisuseError)
  })

  it('let finalize wait for the open transaction instead of closing under it', async () => {
    const { db, rows } = await table()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const writing = db.withTransactionAsync(async (t) => {
      await t.runAsync('INSERT INTO t VALUES (1)')
      await finished
    })

    let finalized = false
    const finalizing = db.finalize!().then(() => {
      finalized = true
    })
    await pause()
    expect(finalized).toBe(false)

    finish()
    await Promise.all([writing, finalizing])
    expect(await rows()).toEqual([1])
  })

  it('let no transaction start once finalize has run', async () => {
    const { db, rows } = await table()
    await db.finalize!()

    void db.withTransactionAsync(async (t) => {
      await t.runAsync('INSERT INTO t VALUES (1)')
    })
    await pause()

    expect(await rows()).toEqual([])
  })

  it('close the handle when the body ends', async () => {
    const { db } = await table()
    let kept: Parameters<Parameters<typeof db.withTransactionAsync>[0]>[0] | undefined

    await db.withTransactionAsync(async (t) => {
      kept = t
    })

    await expect(kept?.runAsync('INSERT INTO t VALUES (1)')).rejects.toThrow('has ended')
    await expect(kept?.withTransactionAsync(async () => {})).rejects.toThrow('has ended')
  })

  it('run a statement in the calling tick when nothing is open', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
    const file = path.join(dir, 'db.sqlite')
    const db = createBetterSqlite3Database(file)
    const observer = new sqlite3(file)
    try {
      await db.execAsync('CREATE TABLE t (x INTEGER)')

      const write = db.runAsync('INSERT INTO t VALUES (1)')

      // Read through another connection before this test yields even once.
      expect(observer.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 })
      await write
    } finally {
      observer.close()
      db.close?.()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
