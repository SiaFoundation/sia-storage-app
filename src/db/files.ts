import * as SQLite from 'expo-sqlite'

export type FileRecord = {
  id: string
  uri: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  status: 'done' | 'error'
  metadata: unknown | null
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
      'metadata',
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
      status TEXT NOT NULL CHECK (status IN ('done','error')),
      metadata TEXT
    );`
  )
}

export async function createFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, uri, fileName, fileSize, createdAt, status, metadata } =
    fileRecord
  await db.runAsync(
    'INSERT OR REPLACE INTO fileRecords (id, uri, fileName, fileSize, createdAt, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    uri,
    fileName,
    fileSize,
    createdAt,
    status,
    metadata == null ? null : JSON.stringify(metadata)
  )
}

export async function createManyFileRecords(
  fileRecords: FileRecord[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const fr of fileRecords) {
      await db.runAsync(
        'INSERT OR REPLACE INTO fileRecords (id, uri, fileName, fileSize, createdAt, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
        fr.id,
        fr.uri,
        fr.fileName,
        fr.fileSize,
        fr.createdAt,
        fr.status,
        fr.metadata == null ? null : JSON.stringify(fr.metadata)
      )
    }
  })
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  const rows = await db.getAllAsync<{
    id: string
    uri: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    status: 'done' | 'error'
    metadata: string | null
  }>(
    'SELECT id, uri, fileName, fileSize, createdAt, status, metadata FROM fileRecords ORDER BY createdAt DESC'
  )

  return rows.map((r) => ({
    id: r.id,
    uri: r.uri,
    fileName: r.fileName,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    status: r.status,
    metadata: parseJson(r.metadata),
  }))
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, uri, fileName, fileSize, createdAt, status, metadata } =
    fileRecord
  await db.runAsync(
    'UPDATE fileRecords SET uri = ?, fileName = ?, fileSize = ?, createdAt = ?, status = ?, metadata = ? WHERE id = ?',
    uri,
    fileName,
    fileSize,
    createdAt,
    status,
    metadata == null ? null : JSON.stringify(metadata),
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
  const row = await db.getFirstAsync<{
    id: string
    uri: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    status: 'done' | 'error'
    metadata: string | null
  }>(
    'SELECT id, uri, fileName, fileSize, createdAt, status, metadata FROM fileRecords WHERE id = ?',
    id
  )
  if (!row) return null
  return {
    id: row.id,
    uri: row.uri,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    status: row.status,
    metadata: parseJson(row.metadata),
  }
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
      metadata: { seeded: true },
    })
  }
}

function parseJson(value: string | null): unknown | null {
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function updateFileMetadata(
  id: string,
  metadata: unknown | null
): Promise<void> {
  await db.runAsync(
    'UPDATE fileRecords SET metadata = ? WHERE id = ?',
    metadata == null ? null : JSON.stringify(metadata),
    id
  )
}

export async function updateFileStatus(
  id: string,
  status: 'done' | 'error'
): Promise<void> {
  await db.runAsync(
    'UPDATE fileRecords SET status = ? WHERE id = ?',
    status,
    id
  )
}
