import type { DatabaseAdapter } from '../../adapters/db'
import * as ops from '../../db/operations'
import type { FsIOAdapter } from '../../services/fsFileUri'
import { getFsFileUri } from '../../services/fsFileUri'
import type { UploaderAdapters } from '../../services/uploader'
import { type FileEntry, UploadManager } from '../../services/uploader'
import type { AppService, AppServiceInternal } from '../service'

export type { UploaderAdapters }

/** Builds the uploader namespace and creates the UploadManager instance. */
export function buildUploaderNamespace(
  db: DatabaseAdapter,
  fsIO: FsIOAdapter,
): { namespace: AppService['uploader']; manager: UploadManager } {
  const manager = new UploadManager()

  const namespace: AppService['uploader'] = {
    async enqueueByIds(fileIds) {
      let queued = 0
      let skipped = 0
      const entries: FileEntry[] = []
      for (const fileId of fileIds) {
        const file = await ops.readFile(db, fileId)
        if (!file) {
          skipped++
          continue
        }
        const fileUri = await getFsFileUri(db, file, fsIO)
        if (!fileUri) {
          skipped++
          continue
        }
        entries.push({ fileId: file.id, fileUri, file, size: file.size })
        queued++
      }
      if (entries.length > 0) {
        manager.enqueue(entries)
      }
      return { queued, skipped }
    },
    async enqueueWithUri(entries) {
      const fileEntries: FileEntry[] = []
      for (const entry of entries) {
        const file = await ops.readFile(db, entry.fileId)
        if (!file) continue
        fileEntries.push({
          fileId: entry.fileId,
          fileUri: entry.fileUri,
          file,
          size: entry.size,
        })
      }
      if (fileEntries.length > 0) {
        manager.enqueue(fileEntries)
      }
    },
    async shutdown() {
      await manager.shutdown()
    },
    isRunning() {
      return manager.packedCount > 0 || manager.uploadedCount > 0
    },
  }

  return { namespace, manager }
}

/** Wires the UploadManager with a live SDK reference. Called after auth completes. */
export function initUploader(
  manager: UploadManager,
  service: AppService,
  internal: AppServiceInternal,
  adapters: UploaderAdapters,
): void {
  manager.initialize(service, internal, adapters)
}
