import * as SQLite from 'expo-sqlite'
import { type Slab } from 'react-native-sia'

export type FileRecord = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  metadata: unknown | null
  slabs: Slab[] | null
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
      'fileName',
      'fileSize',
      'createdAt',
      'fileType',
      'metadata',
      'slabs',
    ]
    const matches =
      expected.every((e) => colNames.has(e)) &&
      colNames.size === expected.length

    if (colNames.size > 0) {
      const missing = expected.filter((e) => !colNames.has(e))
      if (missing.length === 1 && missing[0] === 'slabs') {
        // Non-destructive migration to add slabs column.
        await db.execAsync('ALTER TABLE fileRecords ADD COLUMN slabs TEXT')
        colNames.add('slabs')
      } else if (missing.length === 1 && missing[0] === 'fileType') {
        await db.execAsync(
          "ALTER TABLE fileRecords ADD COLUMN fileType TEXT NOT NULL DEFAULT 'application/octet-stream'"
        )
        colNames.add('fileType')
      } else if (!matches) {
        await db.execAsync('DROP TABLE IF EXISTS fileRecords')
      }
    }
  } catch {}
  // Create new schema for uploaded items (no in-progress fields persisted).
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS fileRecords (
      id TEXT PRIMARY KEY,
      fileName TEXT,
      fileSize INTEGER,
      createdAt INTEGER NOT NULL,
      fileType TEXT NOT NULL DEFAULT 'application/octet-stream',
      metadata TEXT,
      slabs TEXT
    );`
  )
}

export async function createFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, metadata, slabs } =
    fileRecord
  await db.runAsync(
    'INSERT OR REPLACE INTO fileRecords (id, fileName, fileSize, createdAt, fileType, metadata, slabs) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    metadata == null ? null : JSON.stringify(metadata),
    slabs == null ? null : JSON.stringify(slabs)
  )
}

export async function createManyFileRecords(
  fileRecords: FileRecord[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const fr of fileRecords) {
      await db.runAsync(
        'INSERT OR REPLACE INTO fileRecords (id, fileName, fileSize, createdAt, fileType, metadata, slabs) VALUES (?, ?, ?, ?, ?, ?, ?)',
        fr.id,
        fr.fileName,
        fr.fileSize,
        fr.createdAt,
        fr.fileType,
        fr.metadata == null ? null : JSON.stringify(fr.metadata),
        fr.slabs == null ? null : JSON.stringify(fr.slabs)
      )
    }
  })
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  const rows = await db.getAllAsync<{
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    metadata: string | null
    slabs: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, metadata, slabs FROM fileRecords ORDER BY createdAt DESC'
  )

  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    fileType: r.fileType,
    metadata: parseJson(r.metadata),
    slabs: parseSlabs(r.slabs),
  }))
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, metadata, slabs } =
    fileRecord
  await db.runAsync(
    'UPDATE fileRecords SET fileName = ?, fileSize = ?, createdAt = ?, fileType = ?, metadata = ?, slabs = ? WHERE id = ?',
    fileName,
    fileSize,
    createdAt,
    fileType,
    metadata == null ? null : JSON.stringify(metadata),
    slabs == null ? null : JSON.stringify(slabs),
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
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    metadata: string | null
    slabs: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, metadata, slabs FROM fileRecords WHERE id = ?',
    id
  )
  if (!row) return null
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    fileType: row.fileType,
    metadata: parseJson(row.metadata),
    slabs: parseSlabs(row.slabs),
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

export async function updateFileSlabs(
  id: string,
  slabs: Slab[] | null
): Promise<void> {
  await db.runAsync(
    'UPDATE fileRecords SET slabs = ? WHERE id = ?',
    slabs == null ? null : JSON.stringify(slabs),
    id
  )
}

function parseSlabs(value: string | null): Slab[] | null {
  if (value == null) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as Slab[]) : null
  } catch {
    return null
  }
}
