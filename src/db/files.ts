import * as SQLite from 'expo-sqlite'
import { PinnedObject } from 'react-native-sia'

export type FileRecord = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  pinnedObjects: Record<string, PinnedObject> | null
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
      'pinnedObjects',
    ]
    const matches =
      expected.every((e) => colNames.has(e)) &&
      colNames.size === expected.length

    if (colNames.size > 0) {
      const missing = expected.filter((e) => !colNames.has(e))
      if (missing.length === 1 && missing[0] === 'pinnedObjects') {
        // Non-destructive migration to add pinnedObjects column.
        await db.execAsync(
          'ALTER TABLE fileRecords ADD COLUMN pinnedObjects TEXT'
        )
        colNames.add('pinnedObjects')
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
      pinnedObjects TEXT
    );`
  )
}

export async function createFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, pinnedObjects } =
    fileRecord
  await db.runAsync(
    'INSERT OR REPLACE INTO fileRecords (id, fileName, fileSize, createdAt, fileType, pinnedObjects) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects == null ? null : JSON.stringify(pinnedObjects)
  )
}

export async function createManyFileRecords(
  fileRecords: FileRecord[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const fr of fileRecords) {
      await db.runAsync(
        'INSERT OR REPLACE INTO fileRecords (id, fileName, fileSize, createdAt, fileType, pinnedObjects) VALUES (?, ?, ?, ?, ?, ?)',
        fr.id,
        fr.fileName,
        fr.fileSize,
        fr.createdAt,
        fr.fileType,
        fr.pinnedObjects == null ? null : JSON.stringify(fr.pinnedObjects)
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
    pinnedObjects: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, pinnedObjects FROM fileRecords ORDER BY createdAt DESC'
  )

  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    fileType: r.fileType,
    pinnedObjects: parsePinnedObjects(r.pinnedObjects),
  }))
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, pinnedObjects } =
    fileRecord
  await db.runAsync(
    'UPDATE fileRecords SET fileName = ?, fileSize = ?, createdAt = ?, fileType = ?, pinnedObjects = ? WHERE id = ?',
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects == null ? null : JSON.stringify(pinnedObjects),
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
    pinnedObjects: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, pinnedObjects FROM fileRecords WHERE id = ?',
    id
  )
  if (!row) return null
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    fileType: row.fileType,
    pinnedObjects: parsePinnedObjects(row.pinnedObjects),
  }
}

function parsePinnedObjects(
  value: string | null
): Record<string, PinnedObject> | null {
  if (value == null) return null
  try {
    return JSON.parse(value) as Record<string, PinnedObject>
  } catch {
    return null
  }
}

export async function updateFilePinnedObject(
  id: string,
  indexerURL: string,
  pinnedObject: PinnedObject
): Promise<void> {
  const file = await readFileRecord(id)
  if (file == null) return
  const pos = file.pinnedObjects ?? {}
  pos[indexerURL] = pinnedObject
  await db.runAsync(
    'UPDATE fileRecords SET pinnedObjects = ? WHERE id = ?',
    JSON.stringify(pos),
    id
  )
}
