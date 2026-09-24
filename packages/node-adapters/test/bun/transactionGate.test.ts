import { describe, expect, it } from 'bun:test'
import { createBunDatabase } from '../../src/bunDatabase'
import { TransactionMisuseError } from '../../src/transactionGate'

/*
 * The daemon runs the gate on bun:sqlite, and the gate tells a transaction
 * body's context from other flows' with AsyncLocalStorage. The jest suite runs
 * better-sqlite3 under Node, so these cases are the ones that check Bun keeps
 * that context across a body's awaits.
 */
const pause = () => new Promise((resolve) => setTimeout(resolve, 10))

async function table() {
  const db = createBunDatabase()
  await db.execAsync('CREATE TABLE t (x INTEGER)')
  const rows = async () => (await db.getAllAsync<{ x: number }>('SELECT x FROM t')).map((r) => r.x)
  return { db, rows }
}

describe('transactions on a shared bun:sqlite connection', () => {
  it('run one after another instead of failing', async () => {
    const { db, rows } = await table()
    const tx = (x: number) =>
      db.withTransactionAsync(async (t) => {
        await pause()
        await t.runAsync('INSERT INTO t VALUES (?)', x)
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

  it('refuse the outer adapter inside a body after an await', async () => {
    const { db } = await table()

    await expect(
      db.withTransactionAsync(async () => {
        await pause()
        await db.runAsync('INSERT INTO t VALUES (1)')
      }),
    ).rejects.toThrow(TransactionMisuseError)
  })
})
