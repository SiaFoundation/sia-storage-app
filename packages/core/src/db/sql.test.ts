import type { DatabaseAdapter } from '../adapters/db'
import { processInBatches } from './sql'

function mockDb(batches: Record<string, unknown>[][]): DatabaseAdapter {
  let callCount = 0
  return {
    getAllAsync: async () => {
      const result = batches[callCount] ?? []
      callCount++
      return result as never[]
    },
    getFirstAsync: async () => null,
    runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
    execAsync: async () => {},
    withTransactionAsync: async (fn) => fn(),
  }
}

describe('processInBatches', () => {
  it('returns 0 for empty result set', async () => {
    const db = mockDb([[]])
    const total = await processInBatches(
      db,
      'SELECT id FROM t WHERE x = ?',
      [1],
      500,
      async () => {},
    )
    expect(total).toBe(0)
  })

  it('processes a single batch', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const db = mockDb([rows, []])
    const processed: string[][] = []
    const total = await processInBatches<{ id: string }>(
      db,
      'SELECT id FROM t WHERE done = 0',
      [],
      500,
      async (batch) => {
        processed.push(batch.map((r) => r.id))
      },
    )
    expect(total).toBe(2)
    expect(processed).toEqual([['a', 'b']])
  })

  it('processes multiple batches until empty', async () => {
    const db = mockDb([[{ id: '1' }, { id: '2' }], [{ id: '3' }], []])
    const processed: string[][] = []
    const total = await processInBatches<{ id: string }>(
      db,
      'SELECT id FROM t WHERE done = 0',
      [],
      2,
      async (batch) => {
        processed.push(batch.map((r) => r.id))
      },
    )
    expect(total).toBe(3)
    expect(processed).toEqual([['1', '2'], ['3']])
  })

  it('passes params and batchSize to query', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const db: DatabaseAdapter = {
      getAllAsync: async (sql, ...params) => {
        calls.push({ sql, params })
        return []
      },
      getFirstAsync: async () => null,
      runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
      execAsync: async () => {},
      withTransactionAsync: async (fn) => fn(),
    }
    await processInBatches(db, 'SELECT id FROM t WHERE x = ?', [42], 100, async () => {})
    expect(calls[0].sql).toBe('SELECT id FROM t WHERE x = ? LIMIT ?')
    expect(calls[0].params).toEqual([42, 100])
  })
})
