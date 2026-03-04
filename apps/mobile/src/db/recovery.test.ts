import { database, db, initializeDB, resetDb, withRecovery } from '.'

const NPE_MESSAGE =
  'Call to function has been rejected. java.lang.NullPointerException'

beforeEach(async () => {
  await initializeDB({ databaseName: ':memory:' })
})

afterEach(async () => {
  await resetDb()
})

describe('withRecovery', () => {
  it('returns the result on success', async () => {
    const result = await withRecovery(async () => 42)
    expect(result).toBe(42)
  })

  it('throws non-NPE errors without retrying', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('UNIQUE constraint'))
    await expect(withRecovery(fn)).rejects.toThrow('UNIQUE constraint')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once on NPE and returns the retry result', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error(NPE_MESSAGE))
      .mockResolvedValueOnce('recovered')
    const result = await withRecovery(fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws if retry also fails', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error(NPE_MESSAGE))
      .mockRejectedValueOnce(new Error('second failure'))
    await expect(withRecovery(fn)).rejects.toThrow('second failure')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('db() proxy recovery', () => {
  it('recovers from NPE on a query method', async () => {
    // Make the current database throw NPE on first call.
    jest
      .spyOn(database, 'getAllAsync')
      .mockRejectedValueOnce(new Error(NPE_MESSAGE))

    // The proxy should detect NPE, reopen the connection, and retry.
    // After reopening, the new database handles the query.
    const rows = await db().getAllAsync<{ value: number }>('SELECT 1 as value')
    expect(rows).toEqual([{ value: 1 }])
  })

  it('does not recover from non-NPE errors', async () => {
    jest
      .spyOn(database, 'getAllAsync')
      .mockRejectedValueOnce(new Error('disk I/O error'))

    await expect(db().getAllAsync('SELECT 1')).rejects.toThrow('disk I/O error')
  })
})
