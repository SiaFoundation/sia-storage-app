import { Directory, File, Paths } from 'expo-file-system'
import useSWR, { mutate } from 'swr'
import { db } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'
import { extFromMime } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { buildSWRHelpers } from '../lib/swr'

/**
 * Persistent file system used for storing local copies of files.
 */

const { getKey, triggerChange } = buildSWRHelpers('fs/files')

function swrKeyFsFileUri(fileId?: string) {
  return [...getKey(fileId), 'uri']
}

export type FsFileInfo = {
  id: string
  type: string
}

export type FsMetaRow = {
  fileId: string
  size: number
  addedAt: number
  usedAt: number
}

export const fsStorageDirectory = new Directory(Paths.document, 'files')

export function fsTriggerRefresh(fileId?: string): Promise<void> {
  return triggerChange(fileId)
}

export function listFilesInFsStorageDirectory(): File[] {
  const info = fsStorageDirectory.info()
  if (!info.exists) {
    return []
  }
  const entries = fsStorageDirectory.list()
  return entries.filter((entry): entry is File => entry instanceof File)
}

export function ensureFsStorageDirectory(): void {
  const info = fsStorageDirectory.info()
  if (!info.exists) {
    fsStorageDirectory.create({ intermediates: true })
  }
}

function getFsFileForId(file: FsFileInfo): File {
  return new File(fsStorageDirectory, `${file.id}${extFromMime(file.type)}`)
}

// Throttle usedAt updates to reduce DB writes during browsing.
const USED_AT_UPDATE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export async function getFsFileUri(file: FsFileInfo): Promise<string | null> {
  const existingMeta = await readFsFileMetadata(file.id)
  const fsFile = getFsFileForId(file)
  const info = fsFile.info()

  if (!info.exists) {
    // If the file no longer exists, remove the metadata.
    if (existingMeta) {
      await deleteFsFileMetadata(file.id)
    }
    return null
  }

  const size = info.size ?? existingMeta?.size ?? 0
  const now = Date.now()

  // If the file is not tracked yet, insert the metadata.
  if (!existingMeta) {
    await upsertFsFileMetadata({
      fileId: file.id,
      size,
      addedAt: now,
      usedAt: now,
    })
  } else {
    // File exists and is tracked - only update usedAt if it's stale
    const timeSinceLastUse = now - existingMeta.usedAt
    if (timeSinceLastUse > USED_AT_UPDATE_INTERVAL_MS) {
      await updateFsFileMetadataUsedAt(file.id, now)
    }
  }

  return fsFile.uri
}

export async function removeFsFile(file: FsFileInfo): Promise<void> {
  const fsFile = getFsFileForId(file)
  const info = fsFile.info()
  let mutated = false
  if (info.exists) {
    fsFile.delete()
    mutated = true
  }
  const meta = await readFsFileMetadata(file.id)
  if (meta) {
    await deleteFsFileMetadata(file.id)
    mutated = true
  }
  if (mutated) {
    fsTriggerRefresh(file.id)
  }
}

export async function copyFileToFs(
  file: FsFileInfo,
  sourceFile: File,
): Promise<string> {
  logger.debug('fs', 'copy_file', { fileId: file.id, uri: sourceFile.uri })
  const target = getFsFileForId(file)
  const targetInfo = target.info()
  if (targetInfo.exists) {
    target.delete()
  }
  sourceFile.copy(target)
  const destinationInfo = target.info()
  const sourceInfo = sourceFile.info()
  const previous = await readFsFileMetadata(file.id)
  const size = destinationInfo.size ?? sourceInfo.size ?? previous?.size ?? 0
  await upsertFsFileMetadata({
    fileId: file.id,
    size,
    addedAt: previous?.addedAt ?? Date.now(),
    usedAt: Date.now(),
  })
  await mutate(swrKeyFsFileUri(file.id), target.uri, { revalidate: false })
  return target.uri
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR(swrKeyFsFileUri(file?.id), () => {
    return file ? getFsFileUri(file) : null
  })
}

const fsMetadataTable = 'fs'

export async function upsertFsFileMetadata(row: FsMetaRow): Promise<void> {
  await sqlInsert(
    fsMetadataTable,
    {
      fileId: row.fileId,
      size: row.size,
      addedAt: row.addedAt,
      usedAt: row.usedAt,
    },
    { conflictClause: 'OR REPLACE' },
  )
}

export async function deleteFsFileMetadata(fileId: string): Promise<void> {
  await sqlDelete(fsMetadataTable, { fileId })
}

export async function deleteFsFileMetadataBatch(
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const placeholders = fileIds.map(() => '?').join(',')
  await db().runAsync(
    `DELETE FROM ${fsMetadataTable} WHERE fileId IN (${placeholders})`,
    ...fileIds,
  )
}

export async function readFsFileMetadata(
  fileId: string,
): Promise<FsMetaRow | null> {
  return db().getFirstAsync<FsMetaRow>(
    `SELECT fileId, size, addedAt, usedAt FROM ${fsMetadataTable} WHERE fileId = ?`,
    fileId,
  )
}

export async function updateFsFileMetadataUsedAt(
  fileId: string,
  usedAt: number = Date.now(),
): Promise<void> {
  await sqlUpdate(fsMetadataTable, { usedAt }, { fileId })
}

export async function calcFsFilesMetadataTotalSize(): Promise<number> {
  const result = await db().getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(size), 0) AS total FROM ${fsMetadataTable}`,
  )
  return result?.total ?? 0
}
