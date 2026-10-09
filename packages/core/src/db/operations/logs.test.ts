import { insertManyLogs } from './logs'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

const entry = (message: string) => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  level: 'info' as const,
  scope: 'test',
  message,
  data: null,
  createdAt: 0,
})

it('writes no line of a batch whose later insert statement fails', async () => {
  await db().execAsync(
    `CREATE TRIGGER fail_log BEFORE INSERT ON logs WHEN NEW.message = 'last'
     BEGIN SELECT RAISE(ABORT, 'failed'); END`,
  )
  // More lines than one multi-row insert holds, so the batch takes two statements.
  const entries = [...Array.from({ length: 6_000 }, (_, i) => entry(`line ${i}`)), entry('last')]

  // A trigger's error is built by better-sqlite3's native code, which can hold
  // the Error class of another test file in this Jest worker, so toThrow does
  // not always recognise it. Matching the message works either way.
  await expect(insertManyLogs(db(), entries)).rejects.toMatchObject({
    message: expect.stringContaining('failed'),
  })

  expect(await db().getFirstAsync('SELECT count(*) AS n FROM logs')).toEqual({ n: 0 })
})
