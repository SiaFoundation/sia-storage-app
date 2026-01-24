import { LocalObject } from '../encoding/localObject'
import { removeFsFile } from '../stores/fs'
import { removeTempDownloadFile } from '../stores/tempFs'
import {
  deleteManyFileRecordsAndThumbnails,
  deleteFileRecordAndThumbnails,
  FileRecord,
} from '../stores/files'
import {
  deleteLocalObjects,
  deleteManyLocalObjects,
} from '../stores/localObjects'
import { getSdk } from '../stores/sdk'
import { cancelUpload } from '../stores/uploads'

export async function permanentlyDeleteFile(file: FileRecord) {
  cancelUpload(file.id)
  await deleteFileRecordAndThumbnails(file.id)
  await deleteAllIndexerObjects(file)
  await deleteLocalObjects(file.id)
  await removeFsFile(file)
  await removeTempDownloadFile(file)
}

export async function permanentlyDeleteFiles(files: FileRecord[]): Promise<void> {
  if (files.length === 0) return

  const ids = files.map((f) => f.id)
  const hashes = files.map((f) => f.hash).filter(Boolean)

  // Cancel uploads synchronously (fast, in-memory)
  ids.forEach((id) => cancelUpload(id))

  // Batch DB deletes (single transaction, single SWR trigger)
  // Also delete thumbnails for these files
  await deleteManyFileRecordsAndThumbnails(ids, hashes)
  await deleteManyLocalObjects(ids)

  // Network deletions in parallel
  await deleteAllIndexerObjectsForFiles(files)

  // Filesystem deletions in parallel
  await Promise.all(
    files.flatMap((f) => [removeFsFile(f), removeTempDownloadFile(f)])
  )
}

async function deleteAllIndexerObjectsForFiles(
  files: FileRecord[]
): Promise<void> {
  const sdk = getSdk()
  if (!sdk) return

  const objectIds = files.flatMap((f) =>
    Object.values(f.objects ?? {})
      .map((o) => o.id)
      .filter(Boolean)
  )

  // Fire off all deletions in parallel (best effort)
  await Promise.all(
    objectIds.map((id) =>
      sdk.deleteObject(id).catch(() => {
        // Swallow errors - best effort deletion
      })
    )
  )
}

export async function deleteFileFromNetwork(file: FileRecord) {
  await deleteAllIndexerObjects(file)
  await deleteLocalObjects(file.id)
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
      await sdk.deleteObject(object.id)
    }
  }
}
