import type { FsMetaRow } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import { logger } from '@siastorage/logger'
import { Directory, File, Paths } from 'expo-file-system'
import useSWR from 'swr'
import { db } from '../db'
import { extFromMime } from '../lib/fileTypes'
import { swrCacheBy } from '../lib/swr'

/**
 * Persistent file system used for storing local copies of files.
 */

/** Local filesystem URI for a file, keyed by file ID. */
export const fsFileUriCache = swrCacheBy<string | null>()

export type FsFileInfo = {
  id: string
  type: string
}

export type { FsMetaRow } from '@siastorage/core/db/operations'

export const fsStorageDirectory = new Directory(Paths.document, 'files')

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
  let changed = false
  if (info.exists) {
    fsFile.delete()
    changed = true
  }
  const meta = await readFsFileMetadata(file.id)
  if (meta) {
    await deleteFsFileMetadata(file.id)
    changed = true
  }
  if (changed) {
    await fsFileUriCache.set(null, file.id)
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
  await fsFileUriCache.set(target.uri, file.id)
  return target.uri
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR(fsFileUriCache.key(file?.id ?? ''), () => {
    return file ? getFsFileUri(file) : null
  })
}

export async function upsertFsFileMetadata(row: FsMetaRow): Promise<void> {
  await ops.upsertFsFileMetadata(db(), row)
}

export async function deleteFsFileMetadata(fileId: string): Promise<void> {
  await ops.deleteFsFileMetadata(db(), fileId)
}

export async function deleteFsFileMetadataBatch(
  fileIds: string[],
): Promise<void> {
  await ops.deleteFsFileMetadataBatch(db(), fileIds)
}

export async function readFsFileMetadata(
  fileId: string,
): Promise<FsMetaRow | null> {
  return ops.readFsFileMetadata(db(), fileId)
}

export async function updateFsFileMetadataUsedAt(
  fileId: string,
  usedAt: number = Date.now(),
): Promise<void> {
  await ops.updateFsFileMetadataUsedAt(db(), fileId, usedAt)
}

export async function calcFsFilesMetadataTotalSize(): Promise<number> {
  return ops.calcFsFilesMetadataTotalSize(db())
}
