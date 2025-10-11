import * as SQLite from 'expo-sqlite'
import { runMigrations } from './migrations'
import { logger } from '../lib/logger'

export let database: SQLite.SQLiteDatabase
const dbName = 'app.db'

export async function initializeDB(): Promise<void> {
  logger.log('[db] initializing database...')
  database = await SQLite.openDatabaseAsync(dbName)
  // Run pending database migrations at startup.
  await runMigrations(database)
  logger.log('[db] database initialized')
}

// Drop all tables and run migrations again
export async function resetDb() {
  await database.withTransactionAsync(async () => {
    const rows = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    )
    logger.log(
      '[db] dropping tables',
      rows.map((r) => r.name)
    )
    for (let i = 0; i < rows.length; i++) {
      const table = rows[i].name
      await database.execAsync(`DROP TABLE IF EXISTS "${table}"`)
    }
  })
  await runMigrations(database)
}

export function db() {
  return database
}
