import type { FileRecordsQueryOpts } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { logger } from '@siastorage/logger'
import useSWR from 'swr'
import { db } from '../db'
import { createGetterAndSWRHook } from '../lib/selectors'
import { swrCacheBy } from '../lib/swr'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
  libraryStats,
} from './librarySwr'
import { getIndexerURL } from './settings'

export const transformRow = ops.transformRow
export type {
  FileKind,
  FileLocalMetadata,
  FileMetadata,
  FileRecord,
  FileRecordRow,
  ThumbSize,
} from '@siastorage/core/types'
export {
  fileLocalMetadataKeys,
  fileMetadataKeys,
  fileRecordRowKeys,
  ThumbSizes,
} from '@siastorage/core/types'

import type { FileRecord, FileRecordRow } from '@siastorage/core/types'

/** Single file record keyed by file ID. */
const fileByIdCache = swrCacheBy()

export async function createFileRecord(
  fileRecord: Omit<FileRecord, 'objects'>,
  triggerUpdate: boolean = true,
): Promise<void> {
  await ops.insertFileRecord(db(), fileRecord)
  if (triggerUpdate) {
    invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function createManyFileRecords(
  files: Omit<FileRecord, 'objects'>[],
): Promise<void> {
  await ops.insertManyFileRecords(db(), files)
  if (files.length > 0) {
    invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function readAllFileRecordsCount(
  opts: FileRecordsQueryOpts,
): Promise<number> {
  return ops.queryFileRecordsCount(db(), opts)
}

export async function readAllFileRecordsStats(
  opts: FileRecordsQueryOpts,
): Promise<{ count: number; totalBytes: number }> {
  return ops.queryFileRecordsStats(db(), opts)
}

export async function readAllFileRecords(
  opts: FileRecordsQueryOpts,
): Promise<FileRecord[]> {
  return ops.queryFileRecords(db(), opts)
}

export async function readFileRecordsByIds(
  ids: string[],
): Promise<FileRecord[]> {
  return ops.readFileRecordsByIds(db(), ids)
}

export async function readFileRecordByObjectId(
  objectId: string,
  indexerURL: string,
): Promise<FileRecord | null> {
  return ops.readFileRecordByObjectId(db(), objectId, indexerURL)
}

export async function readFileRecordsByLocalIds(localIds: string[]) {
  return ops.readFileRecordsByLocalIds(db(), localIds)
}

export async function readFileRecordsByContentHashes(contentHashes: string[]) {
  return ops.readFileRecordsByContentHashes(db(), contentHashes)
}

export async function readFileRecordByContentHash(hash: string) {
  return ops.readFileRecordByContentHash(db(), hash)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  return ops.readFileRecord(db(), id)
}

export async function updateFileRecord(
  update: Partial<FileRecordRow> & { id: string },
  triggerUpdate: boolean = true,
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
): Promise<void> {
  await ops.updateFileRecordFields(db(), update, options)
  if (triggerUpdate) {
    invalidateCacheLibraryLists()
  }
}

export async function updateManyFileRecords(
  updates: (Partial<FileRecordRow> & { id: string })[],
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
): Promise<void> {
  await ops.updateManyFileRecordFields(db(), updates, options)
  if (updates.length > 0) {
    invalidateCacheLibraryLists()
  }
}

export async function deleteFileRecord(
  id: string,
  triggerUpdate: boolean = true,
): Promise<void> {
  await ops.deleteFileRecordById(db(), id)
  if (triggerUpdate) {
    invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function deleteManyFileRecords(ids: string[]): Promise<void> {
  await ops.deleteManyFileRecordsByIds(db(), ids)
  if (ids.length > 0) {
    invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function deleteFileRecordAndThumbnails(id: string): Promise<void> {
  await ops.deleteFileRecordAndThumbnails(db(), id)
  invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function deleteManyFileRecordsAndThumbnails(
  ids: string[],
): Promise<void> {
  await ops.deleteFileRecordsAndThumbnails(db(), ids)
  invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function deleteLostFiles(): Promise<number> {
  const currentIndexerURL = await getIndexerURL()
  const lostIds = await ops.deleteLostFiles(db(), currentIndexerURL)
  if (lostIds.length > 0) {
    invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
  return lostIds.length
}

export async function deleteAllFileRecords(): Promise<void> {
  await ops.deleteAllFileRecords(db())
}

export async function createFileRecordWithLocalObject(
  fileRecord: Omit<FileRecord, 'objects'>,
  localObject: LocalObject,
  triggerUpdate: boolean = true,
): Promise<void> {
  try {
    await ops.createFileRecordWithLocalObject(db(), fileRecord, localObject)
    if (triggerUpdate) {
      invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    }
  } catch (e) {
    logger.error('db', 'create_file_record_error', { error: e as Error })
    throw e
  }
}

export async function updateFileRecordWithLocalObject(
  fileRecord: Partial<FileRecordRow> & { id: string },
  localObject: LocalObject,
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
  triggerUpdate: boolean = true,
): Promise<void> {
  try {
    await ops.updateFileRecordWithLocalObject(
      db(),
      fileRecord,
      localObject,
      options,
    )
    if (triggerUpdate) {
      invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    }
  } catch (e) {
    logger.error('db', 'update_file_record_error', { error: e as Error })
    throw e
  }
}

type FileRecordCursorColumn = 'createdAt' | 'updatedAt'

export function useFileCountAll() {
  return useSWR(libraryStats.key('count'), () =>
    readAllFileRecordsCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      activeOnly: true,
    }),
  )
}

export function useFileStatsAll() {
  return useSWR(libraryStats.key('stats'), () =>
    readAllFileRecordsStats({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      activeOnly: true,
    }),
  )
}

export const [getFilesLocalOnly, useFilesLocalOnly] = createGetterAndSWRHook(
  libraryStats.key('localOnly'),
  async ({
    limit,
    order,
    orderBy,
    excludeIds,
  }: {
    limit?: number
    order: 'ASC' | 'DESC'
    orderBy?: FileRecordCursorColumn
    excludeIds?: string[]
  }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecords({
      limit,
      after: undefined,
      order,
      orderBy,
      excludeIds,
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: true,
      activeOnly: true,
    })
  },
)

export const [getFileCountLost, useFileCountLost] = createGetterAndSWRHook(
  libraryStats.key('lostCount'),
  async () => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsCount({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: false,
      activeOnly: true,
    })
  },
)

export const [getFileStatsLost, useFileStatsLost] = createGetterAndSWRHook(
  libraryStats.key('lostStats'),
  async () => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsStats({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: false,
      activeOnly: true,
    })
  },
)

export const [getFileCountLocal, useFileCountLocal] = createGetterAndSWRHook(
  libraryStats.key('localCount'),
  async ({ localOnly }: { localOnly: boolean }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsCount({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: !localOnly,
      },
      fileExistsLocally: true,
      activeOnly: true,
    })
  },
)

export const [getFileStatsLocal, useFileStatsLocal] = createGetterAndSWRHook(
  libraryStats.key('localStats'),
  async ({ localOnly }: { localOnly: boolean }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsStats({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: !localOnly,
      },
      fileExistsLocally: true,
      activeOnly: true,
    })
  },
)

export function useFileDetails(id: string) {
  return useSWR(fileByIdCache.key(id), () => readFileRecord(id))
}
