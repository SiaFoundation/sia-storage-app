import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import type { DatabaseAdapter } from '../../adapters/db'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '../migrations'

let _db: DatabaseAdapter & { close(): void }

export function db(): DatabaseAdapter {
  return _db
}

export async function setupTestDb(): Promise<void> {
  _db = createBetterSqlite3Database()
  await runMigrations(_db, sortMigrations(coreMigrations))
}

export async function teardownTestDb(): Promise<void> {
  _db?.close()
}
