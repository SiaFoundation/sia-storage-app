import { type PinnedObject } from 'react-native-sia'
import {
  deserializePinnedObjects,
  PinnedObjectsMap,
  serializePinnedObjects,
} from '../encoding/pinnedObjects'
import { logger } from '../lib/logger'
import { db } from '../db'
import useSWR, { mutate } from 'swr'
import { fileHasAPinnedObject } from '../lib/file'
import { createGetterAndSWRHook } from '../lib/selectors'

export type FileRecord = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  pinnedObjects: Record<string, PinnedObject>
  encryptionKey: string
}

export async function createFileRecord(
  fileRecord: FileRecord,
  triggerUpdate: boolean = true
): Promise<void> {
  const {
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    pinnedObjects,
    encryptionKey,
  } = fileRecord
  await db().runAsync(
    'INSERT OR REPLACE INTO files (id, fileName, fileSize, createdAt, fileType, encryptionKey) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    fileType,
    encryptionKey
  )
  await updateFilePinnedObjects(id, pinnedObjects)
  if (triggerUpdate) {
    await triggerFileListUpdate()
  }
}

export async function createManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await db().withTransactionAsync(async () => {
    for (const fr of files) {
      await createFileRecord(fr, false)
    }
  })
  await triggerFileListUpdate()
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<{
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
  return rows.map(transformRow)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<{
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
  if (!row) {
    logger.log('[db] file not found', id)
    return null
  }
  return transformRow(row)
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
  await db().runAsync(
    'UPDATE files SET fileName = ?, fileSize = ?, createdAt = ?, fileType = ?, encryptionKey = ? WHERE id = ?',
    fileName,
    fileSize,
    createdAt,
    fileType,
    encryptionKey,
    id
  )
  await updateFilePinnedObjects(id, pinnedObjects)
  await triggerFileListUpdate()
}

export async function deleteFileRecord(id: string): Promise<void> {
  await db().runAsync('DELETE FROM files WHERE id = ?', id)
  await triggerFileListUpdate()
}

export async function deleteAllFileRecords(): Promise<void> {
  await db().runAsync('DELETE FROM files')
  await triggerFileListUpdate()
}

export async function updateFilePinnedObjects(
  id: string,
  pinnedObjects: PinnedObjectsMap
): Promise<void> {
  const [serializedPinnedObjects, error] = serializePinnedObjects(pinnedObjects)
  if (error) {
    logger.log('[db] error serializing pinned objects, skipping update', error)
    return
  }
  await db().runAsync(
    'UPDATE files SET pinnedObjects = ? WHERE id = ?',
    serializedPinnedObjects,
    id
  )
  await triggerFileListUpdate()
}

export async function updateFilePinnedObject(
  id: string,
  indexerURL: string,
  pinnedObject: PinnedObject
): Promise<void> {
  const file = await readFileRecord(id)
  if (file == null) {
    logger.log('[db] file not found', id)
    return
  }
  const pos = file.pinnedObjects ?? {}
  pos[indexerURL] = pinnedObject
  const [serializedPinnedObjects, error] = serializePinnedObjects(pos)
  if (error) {
    logger.log('[db] error serializing pinned objects, skipping update', error)
    return
  }
  await db().runAsync(
    'UPDATE files SET pinnedObjects = ? WHERE id = ?',
    serializedPinnedObjects,
    id
  )
  await triggerFileListUpdate()
}

function transformRow(row: {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string
  pinnedObjects: string | null
  encryptionKey: string
}): FileRecord {
  const [pinnedObjects] = deserializePinnedObjects(row.id, row.pinnedObjects)
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    fileType: row.fileType,
    pinnedObjects: pinnedObjects ?? {},
    encryptionKey: row.encryptionKey,
  }
}

const KEY = 'db/files'

const getKey = (id?: string) => {
  return id ? `${KEY}/${id}` : `${KEY}`
}

export function triggerFileListUpdate() {
  return mutate((key: string) => {
    return typeof key === 'string' && key.startsWith(getKey())
  })
}

export function useFileList() {
  return useSWR(getKey(), readAllFileRecords)
}

export function useFileCountAll() {
  return useSWR(getKey('count'), () =>
    readAllFileRecords().then((f) => f.length)
  )
}

export const [getFilesLocalOnly, useFilesLocalOnly] = createGetterAndSWRHook(
  getKey('localOnly'),
  async () => {
    const files = await readAllFileRecords()
    return files.filter((f) => !fileHasAPinnedObject(f))
  }
)

export const [getFileCountLocalOnly, useFileCountLocalOnly] =
  createGetterAndSWRHook(getKey('localOnlyCount'), async () => {
    const files = await getFilesLocalOnly()
    return files.length
  })

export function useFileDetails(id: string) {
  return useSWR(getKey(id), () => readFileRecord(id))
}
