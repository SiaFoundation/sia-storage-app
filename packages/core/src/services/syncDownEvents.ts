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
import type { FileMetadata, FileRecordRow } from '../types/files'

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

  await app.optimize()

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
  const indexerURL = await app.settings.getIndexerURL()
  const appKey = internal.requireSdk().appKey()

  // Phase 1: Prepare — decode metadata and classify events using batch reads.
  // Events with malformed/incomplete metadata are skipped (the only legitimate skip).
  const deleteObjectIds: string[] = []
  const upsertEntries: {
    objectId: string
    object: PinnedObjectRef
    metadata: FileMetadata
    type: 'file' | 'thumbnail'
  }[] = []

  for (const { object, deleted, id } of events) {
    if (signal.aborted) return
    if (deleted) {
      deleteObjectIds.push(id)
      continue
    }
    if (!object) continue
    try {
      const metadata = decodeFileMetadata(object.metadata())
      if (hasCompleteThumbnailMetadata(metadata)) {
        upsertEntries.push({
          objectId: id,
          object,
          metadata,
          type: 'thumbnail',
        })
      } else if (hasCompleteFileMetadata(metadata)) {
        upsertEntries.push({ objectId: id, object, metadata, type: 'file' })
      } else {
        logger.debug('syncDownEvents', 'skipped', {
          reason: 'incomplete_metadata',
        })
      }
    } catch (e) {
      logger.error('syncDownEvents', 'decode_error', {
        id,
        error: e as Error,
      })
      throw e
    }
  }

  // Batch reads: 2 queries instead of N individual lookups.
  const metadataIds = [...new Set(upsertEntries.map((e) => e.metadata.id))]
  const [deleteFileMap, upsertFileMap] = await Promise.all([
    deleteObjectIds.length > 0
      ? app.files.getRowsByObjectIds(deleteObjectIds, indexerURL)
      : new Map<string, FileRecordRow>(),
    metadataIds.length > 0
      ? app.files.getRowsByIds(metadataIds)
      : new Map<string, FileRecordRow>(),
  ])

  // Classify events using batch results.
  const prepared: PreparedEvent[] = []

  for (const objectId of deleteObjectIds) {
    const existing = deleteFileMap.get(objectId)
    if (!existing) {
      logger.debug('syncDownEvents', 'skipped', {
        reason: 'no_file_record',
        objectId,
      })
      continue
    }
    logger.debug('syncDownEvents', 'file_delete', { fileId: existing.id })
    prepared.push({
      kind: 'delete',
      objectId,
      fileId: existing.id,
      fileRecord: existing,
      indexerURL,
    })
  }

  for (const { object, metadata, type } of upsertEntries) {
    const existing = upsertFileMap.get(metadata.id)
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
      const isRemoteNewer = metadata.updatedAt >= existing.updatedAt
      const mergedMetadata = isRemoteNewer ? toFileRecordFields(metadata) : {}
      prepared.push({
        kind: 'update',
        fileRecord: { ...existing, ...mergedMetadata },
        localObject,
        fileId: existing.id,
        tags: metadata.tags,
        directory: metadata.directory,
        isFile: type === 'file',
        isRemoteNewer,
      })
    } else {
      const fileId = metadata.id
      if (type === 'file') {
        logger.debug('syncDownEvents', 'file_create', { hash: metadata.hash })
      } else {
        logger.debug('syncDownEvents', 'thumbnail_create', {
          thumbForId: metadata.thumbForId,
        })
      }
      const localObject = sealPinnedObject(fileId, indexerURL, object, appKey)
      prepared.push({
        kind: 'create',
        fileRecord: {
          ...toFileRecordFields(metadata),
          id: fileId,
          localId: null,
          addedAt: Date.now(),
          deletedAt: null,
        },
        localObject,
        tags: metadata.tags,
        directory: metadata.directory,
        isFile: type === 'file',
      })
    }
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
      e.isRemoteNewer = true
    } else {
      seenFileIds.add(id)
    }
  }

  // Phase 2: Commit — apply all prepared events in a single DB transaction.
  // Errors propagate to roll back the transaction and prevent cursor advancement,
  // so the batch retries next cycle.
  const creates = prepared.filter(
    (e): e is PreparedCreate => e.kind === 'create',
  )
  const updates = prepared.filter(
    (e): e is PreparedUpdate => e.kind === 'update',
  )
  const deletes = prepared.filter(
    (e): e is PreparedDelete => e.kind === 'delete',
  )

  let deletedFileIds: string[] = []
  await internal.withTransaction(async () => {
    // 2A: Single UPSERT for all creates + isRemoteNewer updates.
    // ON CONFLICT(id) DO UPDATE SET only touches metadata fields —
    // addedAt, localId, deletedAt, lostReason are preserved from
    // the existing row, so tombstones can't be cleared by sync.
    const fileUpserts = [
      ...creates.map((e) => e.fileRecord),
      ...updates.filter((e) => e.isRemoteNewer).map((e) => e.fileRecord),
    ]
    if (fileUpserts.length > 0) {
      await app.files.upsertMany(fileUpserts, { skipCurrentRecalc: true })
    }

    // 2B: Batch upsert all local objects (creates + updates).
    const allLocalObjects = [
      ...creates.map((e) => e.localObject),
      ...updates.map((e) => e.localObject),
    ]
    if (allLocalObjects.length > 0) {
      await app.localObjects.upsertMany(allLocalObjects, {
        skipInvalidation: true,
      })
    }

    // 2C: Batch deletes.
    if (deletes.length > 0) {
      // Delete local objects for all delete events.
      await app.localObjects.deleteManyByObjectIds(
        deletes.map((e) => e.objectId),
        indexerURL,
        { skipInvalidation: true },
      )

      // Batch tombstone files that aren't already tombstoned.
      const toTombstone = deletes
        .filter((e) => !e.fileRecord.deletedAt)
        .map((e) => e.fileId)
      if (toTombstone.length > 0) {
        await app.files.tombstone(toTombstone, { skipInvalidation: true })
      }

      // Find files with no remaining objects (fully deleted).
      const deleteFileIdSet = [...new Set(deletes.map((e) => e.fileId))]
      deletedFileIds =
        await app.localObjects.queryFilesWithNoObjects(deleteFileIdSet)
    }

    counts.added += creates.length
    counts.existing += updates.length
    counts.deleted += deletedFileIds.length
  })

  // Phase 3: Cleanup — delete local files for deleted records, clear
  // upload state for updated records, sync tags/directories. Cache
  // invalidation is deferred to the end of the batch to avoid triggering
  // React re-render depth limits when processing large batches.
  const deletedFileIdSet = new Set(deletedFileIds)
  let needsLibraryInvalidation = false

  // 3A: FS cleanup (non-fatal).
  for (const event of deletes) {
    if (deletedFileIdSet.has(event.fileId)) {
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
    }
  }

  // Cache invalidation for updates.
  for (const event of updates) {
    app.caches.fileById.invalidate(event.fileId)
    needsLibraryInvalidation = true
  }

  // 3B + 3C: Batch directory and tag sync.
  const syncableEvents = prepared.filter(
    (e): e is PreparedCreate | PreparedUpdate =>
      e.kind !== 'delete' &&
      e.isFile &&
      (e.kind === 'create' || (e.kind === 'update' && e.isRemoteNewer)),
  )

  // 3B: Batch directory sync.
  const dirEntries = syncableEvents
    .filter((e) => e.directory !== undefined)
    .map((e) => ({ fileId: e.fileRecord.id, directoryName: e.directory! }))
  let oldDirGroups: { name: string; directoryId: string | null }[] = []
  if (dirEntries.length > 0) {
    oldDirGroups = await app.directories.syncManyFromMetadata(dirEntries, {
      skipInvalidation: true,
    })
    needsLibraryInvalidation = true
  }

  // 3C: Batch tag sync.
  const tagEntries = syncableEvents
    .filter((e) => e.tags !== undefined && e.tags.length > 0)
    .map((e) => ({ fileId: e.fileRecord.id, tagNames: e.tags! }))
  if (tagEntries.length > 0) {
    await app.tags.syncManyFromMetadata(tagEntries, {
      skipInvalidation: true,
    })
    needsLibraryInvalidation = true
  }

  if (creates.length > 0) {
    needsLibraryInvalidation = true
  }

  // 3D: Cache invalidation.
  if (needsLibraryInvalidation) {
    app.caches.tags.invalidateAll()
    app.caches.directories.invalidateAll()
    app.caches.libraryVersion.invalidate()
  }

  // Phase 4: Recalculate current column for all affected version groups
  // in one pass, rather than per-file during the batch.
  const affectedFileIds: string[] = []
  for (const e of prepared) {
    if (e.kind === 'delete') {
      affectedFileIds.push(e.fileId)
    } else if (e.isFile) {
      affectedFileIds.push(e.fileRecord.id)
    }
  }
  if (affectedFileIds.length > 0) {
    await app.files.recalculateCurrent(affectedFileIds)
  }
  // Recalculate old directory groups from Phase 3B. When a file moves from
  // dir-A to dir-B, the file-ID-based recalculation above handles dir-B
  // (the file's current directory). The old group (dir-A) needs separate
  // recalculation to promote the next version as current.
  if (oldDirGroups.length > 0) {
    await app.files.recalculateCurrentForGroups(oldDirGroups)
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
