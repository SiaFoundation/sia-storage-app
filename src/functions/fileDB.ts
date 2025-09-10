import * as SQLite from 'expo-sqlite'

export type FileRecord = {
  id: string
  uri: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  status: 'done' | 'error'
}

let db: SQLite.SQLiteDatabase

export async function initFileDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync('app.db')
  // Ensure schema matches expected columns; drop legacy table if incompatible.
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('fileRecords')"
    )
    const colNames = new Set(cols.map((c) => c.name))
    const expected = [
      'id',
      'uri',
      'fileName',
      'fileSize',
      'createdAt',
      'status',
    ]
    const matches =
      expected.every((e) => colNames.has(e)) &&
      colNames.size === expected.length
    if (!matches && colNames.size > 0) {
      await db.execAsync('DROP TABLE IF EXISTS fileRecords')
    }
  } catch {}
  // Create new schema for uploaded items (no in-progress fields persisted).
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS fileRecords (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL,
      fileName TEXT,
      fileSize INTEGER,
      createdAt INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done','error'))
    );`
  )
}

export async function createFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, uri, fileName, fileSize, createdAt, status } = fileRecord
  await db.runAsync(
    'INSERT OR REPLACE INTO fileRecords (id, uri, fileName, fileSize, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    uri,
    fileName,
    fileSize,
    createdAt,
    status
  )
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  return db.getAllAsync<FileRecord>(
    'SELECT id, uri, fileName, fileSize, createdAt, status FROM fileRecords ORDER BY createdAt DESC'
  )
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, uri, fileName, fileSize, createdAt, status } = fileRecord
  await db.runAsync(
    'UPDATE fileRecords SET uri = ?, fileName = ?, fileSize = ?, createdAt = ?, status = ? WHERE id = ?',
    uri,
    fileName,
    fileSize,
    createdAt,
    status,
    id
  )
}

export async function deleteFileRecord(id: string): Promise<void> {
  await db.runAsync('DELETE FROM fileRecords WHERE id = ?', id)
}

export async function deleteAllFileRecords(): Promise<void> {
  await db.runAsync('DELETE FROM fileRecords')
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRecord>(
    'SELECT id, uri, fileName, fileSize, createdAt, status FROM fileRecords WHERE id = ?',
    id
  )
  return row ?? null
}

export async function seedDB(numberOfEntires = 10) {
  const now = Date.now()
  for (let i = 0; i < numberOfEntires; i++) {
    await createFileRecord({
      id: `seed-${now}-${i}`,
      uri: `https://picsum.photos/seed/${i}/300/300`,
      fileName: `file-${i}.jpg`,
      fileSize: 1024 * (i + 1),
      createdAt: now - i * 1000,
      status: 'done',
    })
  }
}
