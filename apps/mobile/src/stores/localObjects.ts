import * as ops from '@siastorage/core/db/operations'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { db } from '../db'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from './librarySwr'

export async function readLocalObjectsForFile(
  fileId: string,
): Promise<LocalObject[]> {
  return ops.queryLocalObjectsForFile(db(), fileId)
}

export async function upsertLocalObject(
  object: LocalObject,
  triggerUpdate: boolean = true,
): Promise<void> {
  await ops.insertLocalObject(db(), object)
  if (triggerUpdate) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function deleteLocalObject(
  objectId: string,
  indexerURL: string,
  triggerUpdate: boolean = true,
): Promise<void> {
  await ops.deleteLocalObjectById(db(), objectId, indexerURL)
  if (triggerUpdate) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function countLocalObjectsForFile(
  fileId: string,
): Promise<number> {
  return ops.countLocalObjectsForFile(db(), fileId)
}

export async function deleteLocalObjects(
  fileId: string,
  triggerUpdate: boolean = true,
): Promise<void> {
  await ops.deleteLocalObjectsByFileId(db(), fileId)
  if (triggerUpdate) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function deleteManyLocalObjects(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  await ops.deleteManyLocalObjectsByFileIds(db(), fileIds)
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function readLocalObjectsForFiles(
  fileIds: string[],
): Promise<Record<string, LocalObject[]>> {
  return ops.queryLocalObjectsForFiles(db(), fileIds)
}
