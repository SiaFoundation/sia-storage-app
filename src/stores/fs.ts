import { Directory, File, Paths } from 'expo-file-system'
import useSWR from 'swr'
import { db } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'
import { extFromMime } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { buildSWRHelpers } from '../lib/swr'

/**
 * Persistent file system used for storing local copies of files.
 */

const { getKey, triggerChange } = buildSWRHelpers('fs/files')

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

export async function getFsFileUri(file: FsFileInfo): Promise<string | null> {
  const existingMeta = await readFsFileMetadata(file.id)
  const fsFile = getFsFileForId(file)
  const info = fsFile.info()
  if (!info.exists) {
    // If the file no longer exists, remove the metadata.
    if (existingMeta) {
      await deleteFsFileMetadata(file.id)
      await fsTriggerRefresh(file.id)
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
    await fsTriggerRefresh(file.id)
  } else {
    // If the file exists, update the last used timestamp.
    await updateFsFileMetadataUsedAt(file.id, now)
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
  logger.debug('fs', `copyFile ${file.id} from ${sourceFile.uri}`)
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
  fsTriggerRefresh(file.id)
  return target.uri
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR([...getKey(file?.id), 'uri'], () => {
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
