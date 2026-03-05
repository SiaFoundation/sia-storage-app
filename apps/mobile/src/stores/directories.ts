import * as ops from '@siastorage/core/db/operations'
import useSWR from 'swr'
import { db } from '../db'
import { swrCacheBy } from '../lib/swr'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from './librarySwr'

export type {
  Directory,
  DirectoryWithCount,
} from '@siastorage/core/db/operations'
export const sanitizeDirectoryName = ops.sanitizeDirectoryName

export const UNFILED_DIRECTORY_ID = '__unfiled__'

export const directoriesSwr = swrCacheBy()

export async function createDirectory(name: string) {
  const dir = await ops.insertDirectory(db(), name)
  directoriesSwr.invalidate('all')
  return dir
}

export async function getOrCreateDirectory(name: string) {
  return ops.getOrCreateDirectory(db(), name)
}

export async function readAllDirectoriesWithCounts() {
  return ops.queryAllDirectoriesWithCounts(db())
}

export async function deleteDirectory(id: string): Promise<void> {
  await ops.deleteDirectory(db(), id)
  directoriesSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function deleteDirectoryAndTrashFiles(id: string): Promise<void> {
  await ops.deleteDirectoryAndTrashFiles(db(), id)
  directoriesSwr.invalidateAll()
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function renameDirectory(id: string, name: string): Promise<void> {
  await ops.renameDirectory(db(), id, name)
  directoriesSwr.invalidate('all')
  invalidateCacheLibraryLists()
}

export async function moveFileToDirectory(
  fileId: string,
  directoryId: string | null,
): Promise<void> {
  await ops.moveFileToDirectory(db(), fileId, directoryId)
  directoriesSwr.invalidate('all')
  directoriesSwr.invalidate(`file/${fileId}`)
  invalidateCacheLibraryLists()
}

export async function moveFilesToDirectory(
  fileIds: string[],
  directoryId: string | null,
): Promise<void> {
  await ops.moveFilesToDirectory(db(), fileIds, directoryId)
  directoriesSwr.invalidate('all')
  for (const id of fileIds) {
    directoriesSwr.invalidate(`file/${id}`)
  }
  invalidateCacheLibraryLists()
}

export async function readDirectoryNameForFile(
  fileId: string,
): Promise<string | undefined> {
  return ops.queryDirectoryNameForFile(db(), fileId)
}

export async function countFilesWithDirectories(
  fileIds: string[],
): Promise<number> {
  return ops.queryCountFilesWithDirectories(db(), fileIds)
}

export async function syncDirectoryFromMetadata(
  fileId: string,
  directoryName: string | undefined,
): Promise<void> {
  if (directoryName === undefined) return
  await ops.syncDirectoryFromMetadata(db(), fileId, directoryName)
  directoriesSwr.invalidate('all')
  directoriesSwr.invalidate(`file/${fileId}`)
  invalidateCacheLibraryLists()
}

// SWR Hooks

export function useAllDirectories() {
  return useSWR(directoriesSwr.key('all'), readAllDirectoriesWithCounts)
}

export function useDirectoryForFile(fileId: string | null) {
  return useSWR(fileId ? directoriesSwr.key(`file/${fileId}`) : null, () =>
    fileId ? readDirectoryNameForFile(fileId) : undefined,
  )
}
