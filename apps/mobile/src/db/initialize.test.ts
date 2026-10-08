import { logger } from '@siastorage/logger'
import { database, db, initializeDB, resetDb } from '.'

beforeEach(async () => {
  await initializeDB({ databaseName: ':memory:' })
})

afterEach(async () => {
  await resetDb()
})

describe('initializeDB', () => {
  it('leaves an open, migrated database alone when called again', async () => {
    const before = database
    const close = jest.spyOn(database, 'closeAsync')

    await initializeDB({ databaseName: ':memory:' })

    expect(close).not.toHaveBeenCalled()
    expect(database).toBe(before)
    close.mockRestore()
  })

  it('opens a new connection when asked to reopen', async () => {
    const before = database

    await initializeDB({ databaseName: ':memory:', reopen: true })

    expect(database).not.toBe(before)
  })

  it('starts a second call only after the first has finished its migrations', async () => {
    const info = jest.spyOn(logger, 'info')
    try {
      await Promise.all([
        initializeDB({ databaseName: 'other.db' }),
        initializeDB({ databaseName: ':memory:' }),
      ])
      const steps = info.mock.calls
        .filter(([scope, message]) => scope === 'db' && /^initializ/.test(String(message)))
        .map(([, message]) => message)
      // Each call finishes before the next starts, so the log alternates.
      expect(steps.length).toBeGreaterThanOrEqual(4)
      expect(steps.every((m, i) => m === (i % 2 === 0 ? 'initializing' : 'initialized'))).toBe(true)
      expect(await db().getFirstAsync<{ one: number }>('SELECT 1 AS one')).toEqual({ one: 1 })
    } finally {
      info.mockRestore()
    }
  })
})
