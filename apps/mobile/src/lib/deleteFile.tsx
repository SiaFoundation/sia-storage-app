import type { FileCleanupDeps } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import { db } from '../db'
import type { FileRecord } from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'
import { removeTempDownloadFile } from '../stores/tempFs'
import { removeUploads } from '../stores/uploads'

const cleanupDeps: FileCleanupDeps = {
  removeFile: async (f) => {
    await removeFsFile(f)
    await removeTempDownloadFile(f)
  },
  removeUploads,
}

export async function trashFiles(fileIds: string[]): Promise<void> {
  await ops.trashFiles(db(), fileIds)
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function restoreFiles(fileIds: string[]): Promise<void> {
  await ops.restoreFiles(db(), fileIds)
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function permanentlyDeleteFile(file: FileRecord) {
  await permanentlyDeleteFiles([file])
}

export async function permanentlyDeleteFiles(
  files: FileRecord[],
): Promise<void> {
  if (files.length === 0) return
  await ops.permanentlyDeleteFilesWithCleanup(db(), files, cleanupDeps)
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function autoPurgeOldTrashedFiles() {
  await ops.autoPurgeOldTrashedFilesWithCleanup(db(), cleanupDeps)
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}
