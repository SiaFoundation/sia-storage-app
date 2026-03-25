import { logger } from '@siastorage/logger'
import type { PinnedObjectRef } from '../adapters/sdk'
import type { AppService, AppServiceInternal } from '../app/service'
import {
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
import type { LocalObject } from '../encoding/localObject'
import { sealPinnedObject } from '../lib/localObjects'
import type { FileMetadata, FileRecord, FileRecordRow } from '../types/files'

const batchSize = 500

type Counts = {
  existing: number
  deleted: number
  added: number
}

// A "create" means no existing file record matches this object.
type PreparedCreate = {
  kind: 'create'
  fileRecord: FileRecordRow
  localObject: LocalObject
  tags?: string[]
  directory?: string
  isFile: boolean
}

// An "update" means a file record already exists; merge metadata fields.
type PreparedUpdate = {
  kind: 'update'
  fileRecord: FileRecordRow
  localObject: LocalObject
  fileId: string
  tags?: string[]
  directory?: string
  isFile: boolean
  isRemoteNewer: boolean
}

// A "delete" means the object was removed from the indexer.
type PreparedDelete = {
  kind: 'delete'
  objectId: string
  fileId: string
  fileRecord: FileRecordRow
  indexerURL: string
}

type PreparedEvent = PreparedCreate | PreparedUpdate | PreparedDelete

/**
 * Syncs down events from the indexer to the local database. The service works by
 * starting with a cursor saved in secure store. It iterates until there are no
 * more events to sync and saves the cursor to secure store after each batch.
 * The service runs again every SYNC_EVENTS_INTERVAL milliseconds.
 *
 * Returns 0 when multiple events were fetched (run again immediately),
 * or void to use the default interval.
 */
export async function syncDownEventsBatch(
  signal: AbortSignal,
  app: AppService,
  internal: AppServiceInternal,
): Promise<number | void> {
  logger.debug('syncDownEvents', 'tick')

  const sdk = internal.requireSdk()

  const counts: Counts = {
    existing: 0,
    added: 0,
    deleted: 0,
  }

  let totalEventsFetched = 0

  while (true) {
    if (signal.aborted) break
    try {
      const cursor = await app.sync.getSyncDownCursor()
      logger.debug('syncDownEvents', 'syncing', {
        id: cursor?.id,
        after: cursor?.after,
      })

      const events = await sdk.objectEvents(cursor, batchSize)
      totalEventsFetched += events.length

      if (totalEventsFetched > 1) {
        app.sync.setState({
          isSyncingDown: true,
          syncDownExisting: counts.existing,
          syncDownAdded: counts.added,
          syncDownDeleted: counts.deleted,
        })
      }

      // If the batch size is 1, we are probably synced and repeatedly polling the last event.
      if (events.length === 1) {
        logger.debug('syncDownEvents', 'batch', { size: events.length })
      } else {
        logger.info('syncDownEvents', 'batch', { size: events.length })
      }

      const prevTotal = counts.added + counts.deleted + counts.existing
      await processBatch(events, counts, signal, app, internal)
      const batchChanged =
        counts.added + counts.deleted + counts.existing > prevTotal

      // Update the cursor to the last event in the batch.
      const lastEvent = events[events.length - 1]
      const nextTimestamp = lastEvent ? lastEvent.updatedAt.getTime() + 1 : 0
      if (lastEvent) {
        await app.sync.setSyncDownCursor({
          id: lastEvent.id,
          after: new Date(nextTimestamp),
        })
      }

      // Update progress after each batch. Only report isSyncing when there are
      // real events to process (>1), not on the periodic heartbeat check which
      // returns a single cursor-marker event.
      app.sync.setState({
        isSyncingDown: totalEventsFetched > 1,
        syncDownExisting: counts.existing,
        syncDownAdded: counts.added,
        syncDownDeleted: counts.deleted,
      })
      if (batchChanged) {
        app.caches.library.invalidateAll()
        app.caches.libraryVersion.invalidate()
      }

      // If the batch is not full, we're done for now.
      if (events.length < batchSize) {
        break
      }
    } catch (e) {
      logger.error('syncDownEvents', 'sync_error', { error: e as Error })
      break
    }
  }

  logger.info('syncDownEvents', 'synced', {
    existing: counts.existing,
    added: counts.added,
    deleted: counts.deleted,
  })

  const willContinue = totalEventsFetched > 1 && !signal.aborted
  app.sync.setState({
    isSyncingDown: willContinue,
    syncDownExisting: counts.existing,
    syncDownAdded: counts.added,
    syncDownDeleted: counts.deleted,
  })

  if (willContinue) {
    return 0 // Zero interval — poll again immediately.
  }
}

async function processBatch(
  events: {
    id: string
    object?: PinnedObjectRef
    deleted?: boolean
    updatedAt: Date
  }[],
  counts: Counts,
  signal: AbortSignal,
  app: AppService,
  internal: AppServiceInternal,
) {
  // Phase 1: Prepare — read DB state without holding any locks. Each event
  // is classified as create/update/delete based on whether a matching
  // file record exists.
  const prepared: PreparedEvent[] = []
  const indexerURL = await app.settings.getIndexerURL()

  for (const { object, deleted, id } of events) {
    if (signal.aborted) return
    if (deleted) {
      const result = await prepareDelete(id, indexerURL, app)
      if (result) prepared.push(result)
      continue
    }
    if (!object) continue
    const result = await prepareUpsert(id, object, indexerURL, app, internal)
    if (result) prepared.push(result)
  }

  if (prepared.length === 0 || signal.aborted) return

  // Dedup: multiple objects can share metadata.id (e.g., same file uploaded
  // from two devices pre-migration). Phase 1 reads happen before any writes,
  // so both resolve as 'create'. Convert duplicates to 'update' so the file
  // record is created only once while each object's localObject is upserted.
  const seenFileIds = new Set<string>()
  for (const event of prepared) {
    if (event.kind !== 'create') continue
    const id = event.fileRecord.id
    if (seenFileIds.has(id)) {
      const e = event as unknown as PreparedUpdate
      e.kind = 'update'
      e.fileId = id
    } else {
      seenFileIds.add(id)
    }
  }

  // Phase 2: Commit — apply all prepared events in a single DB transaction.
  // Per-event error handling ensures one failure doesn't abort the batch.
  const deletedFileIds = new Set<string>()
  await internal.withTransaction(async () => {
    for (const event of prepared) {
      try {
        switch (event.kind) {
          case 'create':
            await app.files.create(event.fileRecord, undefined, {
              skipInvalidation: true,
            })
            await app.localObjects.upsert(event.localObject, {
              skipInvalidation: true,
            })
            counts.added++
            break
          case 'update':
            await app.files.update(event.fileRecord, {
              includeUpdatedAt: true,
              skipInvalidation: true,
            })
            await app.localObjects.upsert(event.localObject, {
              skipInvalidation: true,
            })
            counts.existing++
            break
          case 'delete':
            // Delete event: the remote object was deleted from this indexer.
            //
            // 1. Remove the local object row for this indexer.
            // 2. Tombstone the file (set deletedAt) so it's hidden from the
            //    UI and won't be resurrected by future sync events.
            //
            // File rows are NEVER removed from the database. In our
            // event-log sync model, the tombstone is the permanent record
            // that this file was deleted. Without it, a future sync event
            // from another device or indexer would recreate the file.
            // This is the same principle as CRDT tombstones.
            //
            // If the file has objects on other indexers, syncUp will
            // eventually process the tombstone and call deleteObject for
            // each remaining object. The object rows get cleaned up but
            // the file row with its tombstone persists indefinitely.
            await app.localObjects.delete(event.objectId, event.indexerURL, {
              skipInvalidation: true,
            })
            if (!event.fileRecord.deletedAt) {
              const now = Date.now()
              await app.files.update(
                {
                  id: event.fileId,
                  deletedAt: now,
                  trashedAt: event.fileRecord.trashedAt ?? now,
                },
                { includeUpdatedAt: false, skipInvalidation: true },
              )
            }
            if ((await app.localObjects.countForFile(event.fileId)) === 0) {
              deletedFileIds.add(event.fileId)
              counts.deleted++
            }
            break
        }
      } catch (e) {
        logger.error('syncDownEvents', 'event_commit_error', {
          kind: event.kind,
          error: e as Error,
        })
      }
    }
  })

  // Phase 3: Cleanup — delete local files for deleted records, clear
  // upload state for updated records, sync tags/directories. Errors
  // here are non-fatal. Cache invalidation is deferred to the end of
  // the batch to avoid triggering React re-render depth limits when
  // processing large batches (e.g. 500 files from archive sync).
  let needsLibraryInvalidation = false
  for (const event of prepared) {
    if (event.kind === 'delete' && deletedFileIds.has(event.fileId)) {
      try {
        await app.fs.removeFile({
          id: event.fileRecord.id,
          type: event.fileRecord.type,
        })
      } catch (e) {
        logger.error('syncDownEvents', 'cleanup_error', {
          error: e as Error,
        })
      }
    } else if (event.kind === 'update') {
      app.caches.fileById.invalidate(event.fileId)
      needsLibraryInvalidation = true
    }
    if (event.kind !== 'delete' && event.isFile) {
      const shouldSync =
        event.kind === 'create' ||
        (event.kind === 'update' && event.isRemoteNewer)
      if (shouldSync) {
        try {
          await app.tags.syncFromMetadata(event.fileRecord.id, event.tags, {
            skipInvalidation: true,
          })
        } catch (e) {
          logger.error('syncDownEvents', 'tag_sync_error', {
            fileId: event.fileRecord.id,
            error: e as Error,
          })
        }
        try {
          await app.directories.syncFromMetadata(
            event.fileRecord.id,
            event.directory,
            { skipInvalidation: true },
          )
        } catch (e) {
          logger.error('syncDownEvents', 'directory_sync_error', {
            fileId: event.fileRecord.id,
            error: e as Error,
          })
        }
        needsLibraryInvalidation = true
      }
    }
  }
  if (needsLibraryInvalidation) {
    app.caches.tags.invalidateAll()
    app.caches.directories.invalidateAll()
    app.caches.libraryVersion.invalidate()
  }
}

async function prepareDelete(
  id: string,
  indexerURL: string,
  app: AppService,
): Promise<PreparedDelete | null> {
  try {
    const existingFileRecord = await app.files.getByObjectId(id, indexerURL)
    if (!existingFileRecord) {
      logger.debug('syncDownEvents', 'skipped', {
        reason: 'no_file_record',
        objectId: id,
      })
      return null
    }
    logger.info('syncDownEvents', 'file_delete', {
      fileId: existingFileRecord.id,
    })
    return {
      kind: 'delete',
      objectId: id,
      fileId: existingFileRecord.id,
      fileRecord: existingFileRecord,
      indexerURL,
    }
  } catch (e) {
    logger.error('syncDownEvents', 'delete_error', { id, error: e as Error })
    throw e
  }
}

async function prepareUpsert(
  id: string,
  object: PinnedObjectRef,
  indexerURL: string,
  app: AppService,
  internal: AppServiceInternal,
): Promise<PreparedCreate | PreparedUpdate | null> {
  try {
    const metadata = decodeFileMetadata(object.metadata())
    if (hasCompleteThumbnailMetadata(metadata)) {
      const existingThumbnail = await app.files.getById(metadata.id)
      return prepareFileRecord(
        'thumbnail',
        existingThumbnail,
        indexerURL,
        object,
        metadata,
        app,
        internal,
      )
    }
    if (hasCompleteFileMetadata(metadata)) {
      const existingFile = await app.files.getById(metadata.id)
      return prepareFileRecord(
        'file',
        existingFile,
        indexerURL,
        object,
        metadata,
        app,
        internal,
      )
    }
    logger.debug('syncDownEvents', 'skipped', {
      reason: 'incomplete_metadata',
    })
    return null
  } catch (e) {
    logger.error('syncDownEvents', 'update_error', { id, error: e as Error })
    throw e
  }
}

async function prepareFileRecord(
  type: 'file' | 'thumbnail',
  existingFile: FileRecord | null,
  indexerURL: string,
  object: PinnedObjectRef,
  metadata: FileMetadata,
  app: AppService,
  internal: AppServiceInternal,
): Promise<PreparedCreate | PreparedUpdate> {
  const existing = existingFile
  const appKey = internal.requireSdk().appKey()

  if (existing) {
    if (type === 'file') {
      logger.debug('syncDownEvents', 'file_update', { hash: existing.hash })
    } else {
      logger.debug('syncDownEvents', 'thumbnail_update', {
        thumbForId: existing.thumbForId,
      })
    }
    const localObject = sealPinnedObject(
      existing.id,
      indexerURL,
      object,
      appKey,
    )
    let mergedMetadata: Partial<
      Omit<FileRecordRow, 'id' | 'localId' | 'addedAt'>
    >
    if (metadata.updatedAt >= existing.updatedAt) {
      mergedMetadata = toFileRecordFields(metadata)
    } else {
      // Remote metadata is older than local — skip merge. This can happen
      // when events are replayed or arrive out of order.
      mergedMetadata = {}
    }
    return {
      kind: 'update',
      fileRecord: {
        ...existing,
        ...mergedMetadata,
      },
      localObject,
      fileId: existing.id,
      tags: metadata.tags,
      directory: metadata.directory,
      isFile: type === 'file',
      isRemoteNewer: metadata.updatedAt >= existing.updatedAt,
    }
  }

  const fileId = metadata.id
  if (type === 'file') {
    logger.info('syncDownEvents', 'file_create', { hash: metadata.hash })
  } else {
    logger.info('syncDownEvents', 'thumbnail_create', {
      thumbForId: metadata.thumbForId,
    })
  }
  const localObject = sealPinnedObject(fileId, indexerURL, object, appKey)
  const fileRecord: FileRecordRow = {
    ...toFileRecordFields(metadata),
    id: fileId,
    localId: null,
    addedAt: Date.now(),
    deletedAt: null,
  }
  return {
    kind: 'create',
    fileRecord,
    localObject,
    tags: metadata.tags,
    directory: metadata.directory,
    isFile: type === 'file',
  }
}

/** Map decoded metadata to file record fields (all v1 fields preserved). */
function toFileRecordFields(
  metadata: FileMetadata,
): Omit<FileRecordRow, 'id' | 'localId' | 'addedAt' | 'deletedAt'> {
  return {
    name: metadata.name,
    type: metadata.type,
    kind: metadata.kind,
    size: metadata.size,
    hash: metadata.hash,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    thumbForId: metadata.thumbForId,
    thumbSize: metadata.thumbSize,
    trashedAt: metadata.trashedAt ?? null,
  }
}
