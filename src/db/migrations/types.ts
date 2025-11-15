import * as SQLite from 'expo-sqlite'

export type MigrationProgressEvent = {
  id: string
  message: string
}

export type MigrationProgressHandler = (event: MigrationProgressEvent) => void

export type Migration = {
  id: string
  description: string
  up: (
    db: SQLite.SQLiteDatabase,
    onProgress?: MigrationProgressHandler
  ) => Promise<void>
}
