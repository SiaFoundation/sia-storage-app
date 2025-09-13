import * as SQLite from 'expo-sqlite'

export type Migration = {
  id: string
  up: (db: SQLite.SQLiteDatabase) => Promise<void>
}
