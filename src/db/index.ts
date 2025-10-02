import * as SQLite from 'expo-sqlite'
import { runMigrations } from './migrations'
import { logger } from '../lib/logger'

export let database: SQLite.SQLiteDatabase
const dbName = 'temp1.db'

export async function initializeDB(): Promise<void> {
  logger.log('[db] initializing database...')
  database = await SQLite.openDatabaseAsync(dbName)
  // Run pending database migrations at startup.
  await runMigrations(database)
  logger.log('[db] database initialized')
}

export function db() {
  return database
}
