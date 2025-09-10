import * as SQLite from 'expo-sqlite'

export type FileRecord = {
  id: number
  slabID: string
  name: string
  length: number
  offset: number
}

let db: SQLite.SQLiteDatabase

export async function initFileDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync('app.db')
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS fileRecords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slabID TEXT NOT NULL,
      name TEXT NOT NULL,
      length INTEGER NOT NULL,
      offset INTEGER NOT NULL
    );
  `)
}

export async function createFileRecord(
  fileRecord: Omit<FileRecord, 'id'>
): Promise<number> {
  const { slabID, name, length, offset } = fileRecord

  const res = await db.runAsync(
    'INSERT INTO fileRecords (slabID, name, length, offset) VALUES (?, ?, ?, ?)',
    slabID,
    name,
    length,
    offset
  )
  return res.lastInsertRowId ?? 0
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  return db.getAllAsync<FileRecord>(
    'SELECT id, slabID, name, length, offset FROM fileRecords ORDER BY id DESC'
  )
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, slabID, name, length, offset } = fileRecord
  await db.runAsync(
    'UPDATE fileRecords SET slabID = ?, name = ?, length = ?, offset = ? WHERE id = ?',
    slabID,
    name,
    length,
    offset,
    id
  )
}

export async function deleteFileRecord(id: number): Promise<void> {
  await db.runAsync('DELETE FROM fileRecords WHERE id = ?', id)
}

export async function deleteAllFileRecords(): Promise<void> {
  await db.runAsync('DELETE FROM fileRecords')
}

export async function readFileRecord(id: number): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRecord>(
    'SELECT id, slabID, name, length, offset FROM fileRecords WHERE id = ?',
    id
  )
  return row ?? null
}

export async function seedDB(numberOfEntires = 10) {
  for (let i = 0; i < numberOfEntires; i++) {
    await createFileRecord({
      name: 'file' + i,
      slabID: 'slab' + i,
      length: i + 1,
      offset: i + 2,
    })
  }
}
