import type { LocalObject } from '../encoding/localObject'
import {
  deleteFileRecordAndThumbnails,
  deleteManyFileRecordsAndThumbnails,
  type FileRecord,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  deleteLocalObjects,
  deleteManyLocalObjects,
} from '../stores/localObjects'
import { getSdk } from '../stores/sdk'
import { removeTempDownloadFile } from '../stores/tempFs'
import { removeUploads } from '../stores/uploads'
import { logger } from './logger'
import { tryCatch } from './result'

async function tryStep<T>(
  step: string,
  id: string,
  fn: () => Promise<T>,
): Promise<void> {
  const [, err] = await tryCatch(fn)
  if (err) {
    logger.error('deleteFile', 'step_failed', { step, id, error: err as Error })
  }
}

export async function permanentlyDeleteFile(file: FileRecord) {
  removeUploads([file.id])
  await tryStep('deleteFileRecord', file.id, () =>
    deleteFileRecordAndThumbnails(file.id),
  )
  await tryStep('deleteAllIndexerObjects', file.id, () =>
    deleteAllIndexerObjects(file),
  )
  await tryStep('deleteLocalObjects', file.id, () =>
    deleteLocalObjects(file.id),
  )
  await tryStep('removeFsFile', file.id, () => removeFsFile(file))
  await tryStep('removeTempDownloadFile', file.id, () =>
    removeTempDownloadFile(file),
  )
}

export async function permanentlyDeleteFiles(
  files: FileRecord[],
): Promise<void> {
  if (files.length === 0) return

  const ids = files.map((f) => f.id)

  removeUploads(ids)

  // Batch DB deletes (single transaction, single SWR trigger)
  // Also delete thumbnails for these files
  await deleteManyFileRecordsAndThumbnails(ids)
  await deleteManyLocalObjects(ids)

  // Network deletions in parallel
  await deleteAllIndexerObjectsForFiles(files)

  // Filesystem deletions in parallel
  await Promise.all(
    files.flatMap((f) => [removeFsFile(f), removeTempDownloadFile(f)]),
  )
}

async function deleteAllIndexerObjectsForFiles(
  files: FileRecord[],
): Promise<void> {
  const sdk = getSdk()
  if (!sdk) return

  const objectIds = files.flatMap((f) =>
    Object.values(f.objects ?? {})
      .map((o) => o.id)
      .filter(Boolean),
  )

  // Fire off all deletions in parallel (best effort)
  await Promise.all(
    objectIds.map((id) =>
      sdk.deleteObject(id).catch(() => {
        // Swallow errors - best effort deletion
      }),
    ),
  )
}

export async function deleteFileFromNetwork(file: FileRecord) {
  await tryStep('deleteAllIndexerObjects', file.id, () =>
    deleteAllIndexerObjects(file),
  )
  await tryStep('deleteLocalObjects', file.id, () =>
    deleteLocalObjects(file.id),
  )
}

// TODO: in the future if a file is synced with multiple indexers,
// we will need to init and use an sdk for each indexer.
export async function deleteAllIndexerObjects(file: {
  objects?: Record<string, LocalObject>
}) {
  if (!file.objects) return
  const sdk = getSdk()
  if (!sdk) return
  for (const [_, object] of Object.entries(file.objects)) {
    if (object.id) {
      await tryStep('sdk.deleteObject', object.id, () =>
        sdk.deleteObject(object.id),
      )
    }
  }
}
