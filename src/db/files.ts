import * as SQLite from 'expo-sqlite'
import { PinnedObject } from 'react-native-sia'
import { hexToUint8 } from '../lib/hex'
import { arrayBufferToHex } from '../lib/hex'

export type FileRecord = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  pinnedObjects: Record<string, PinnedObject> | null
  encryptionKey: string
}

let db: SQLite.SQLiteDatabase
const dbName = 'siamobile.db'

export async function initFileDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync(dbName)
  // Ensure schema matches expected columns; drop legacy table if incompatible.
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('files')"
    )
    const colNames = new Set(cols.map((c) => c.name))
    const expected = [
      'id',
      'fileName',
      'fileSize',
      'createdAt',
      'fileType',
      'encryptionKey',
      'pinnedObjects',
    ]
    const matches =
      expected.every((e) => colNames.has(e)) &&
      colNames.size === expected.length
    if (!matches) {
      console.warn('Incompatible schema found, dropping table')
      await db.execAsync('DROP TABLE IF EXISTS files')
    } else {
      console.log('Schema matches expected columns')
    }
  } catch {}
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      fileName TEXT,
      fileSize INTEGER,
      createdAt INTEGER NOT NULL,
      fileType TEXT NOT NULL DEFAULT 'application/octet-stream',
      pinnedObjects TEXT,
      encryptionKey TEXT
    );`
  )
}

export async function createFileRecord(fileRecord: FileRecord): Promise<void> {
  const {
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects,
    encryptionKey,
  } = fileRecord
  await db.runAsync(
    'INSERT OR REPLACE INTO files (id, fileName, fileSize, createdAt, fileType, pinnedObjects, encryptionKey) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects == null ? null : serializePinnedObjects(pinnedObjects),
    encryptionKey
  )
}

type SerializedPinnedObject = {
  key: string
  slabs: { id: string; offset: number; length: number }[]
  metadata: string
  createdAt: Date
  updatedAt: Date
}

export function serializePinnedObjects(
  pinnedObjects: Record<string, PinnedObject>
): string {
  const updated: Record<string, SerializedPinnedObject> = {}
  Object.entries(pinnedObjects).forEach(([key, po]) => {
    updated[key] = {
      key: po.key,
      slabs: po.slabs,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      metadata: arrayBufferToHex(po.metadata),
    }
  })
  return JSON.stringify(updated)
}

export function deserializePinnedObjects(
  pinnedObjects: string | null
): Record<string, PinnedObject> {
  if (pinnedObjects == null) return {}
  const serializedParsed: Record<string, SerializedPinnedObject> =
    JSON.parse(pinnedObjects)
  const deserialized = {} as Record<string, PinnedObject>
  Object.entries(serializedParsed).forEach(([key, po]) => {
    deserialized[key] = {
      key: po.key,
      slabs: po.slabs,
      createdAt: new Date(po.createdAt),
      updatedAt: new Date(po.updatedAt),
      metadata: hexToUint8(po.metadata).slice().buffer,
    }
  })
  return deserialized
}

export async function createManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const fr of files) {
      await db.runAsync(
        'INSERT OR REPLACE INTO files (id, fileName, fileSize, createdAt, fileType, pinnedObjects, encryptionKey) VALUES (?, ?, ?, ?, ?, ?, ?)',
        fr.id,
        fr.fileName,
        fr.fileSize,
        fr.createdAt,
        fr.fileType,
        fr.pinnedObjects == null
          ? null
          : serializePinnedObjects(fr.pinnedObjects),
        fr.encryptionKey
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
    encryptionKey: string
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, pinnedObjects, encryptionKey FROM files ORDER BY createdAt DESC'
  )

  console.log('readAllFileRecords rows', rows)

  const files = rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    fileType: r.fileType,
    pinnedObjects: deserializePinnedObjects(r.pinnedObjects),
    encryptionKey: r.encryptionKey,
  }))
  console.log('readAllFileRecords files', files)
  return files
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const {
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects,
    encryptionKey,
  } = fileRecord
  await db.runAsync(
    'UPDATE files SET fileName = ?, fileSize = ?, createdAt = ?, fileType = ?, pinnedObjects = ?, encryptionKey = ? WHERE id = ?',
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects == null ? null : serializePinnedObjects(pinnedObjects),
    encryptionKey,
    id
  )
}

export async function deleteFileRecord(id: string): Promise<void> {
  await db.runAsync('DELETE FROM files WHERE id = ?', id)
}

export async function deleteAllFileRecords(): Promise<void> {
  await db.runAsync('DELETE FROM files')
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<{
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    pinnedObjects: string | null
    encryptionKey: string
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, pinnedObjects, encryptionKey FROM files WHERE id = ?',
    id
  )
  if (!row) return null
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    fileType: row.fileType,
    pinnedObjects: deserializePinnedObjects(row.pinnedObjects),
    encryptionKey: row.encryptionKey,
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
    'UPDATE files SET pinnedObjects = ? WHERE id = ?',
    serializePinnedObjects(pos),
    id
  )
}
