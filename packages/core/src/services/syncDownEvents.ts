import { logger } from '@siastorage/logger'
import type { AppKeyRef, ObjectsCursor, PinnedObjectRef } from '../adapters/sdk'
import type { LocalObject } from '../encoding/localObject'
import {
  type DecodedFileMetadata,
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
import { uniqueId } from '../lib/uniqueId'
import type { FileRecord, FileRecordRow } from '../types/files'

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

// An "adopt" means the remote metadata carries a different canonical ID
// than the local file record (e.g. during v0→v1 migration when another
// device assigned the ID first). The file record is re-parented under
// the canonical ID.
type PreparedAdopt = {
  kind: 'adopt'
  oldFileId: string
  objectId: string
  fileRecord: FileRecordRow
  localObject: LocalObject
  indexerURL: string
  tags?: string[]
  directory?: string
  isFile: boolean
}

type PreparedEvent =
  | PreparedCreate
  | PreparedUpdate
  | PreparedDelete
  | PreparedAdopt

export type SyncDownDeps = {
  sdk: {
    objectEvents(
      cursor: ObjectsCursor | undefined,
      limit: number,
    ): Promise<{ id: string; object?: PinnedObjectRef; deleted?: boolean; updatedAt: Date }[]>
  }
  files: {
    read(id: string): Promise<FileRecord | null>
    readByObjectId(
      objectId: string,
      indexerURL: string,
    ): Promise<FileRecord | null>
    create(fileRecord: Omit<FileRecord, 'objects'>): Promise<void>
    update(
      record: Partial<FileRecordRow> & { id: string },
      options?: { includeUpdatedAt?: boolean },
    ): Promise<void>
    delete(id: string): Promise<void>
  }
  localObjects: {
    upsert(localObject: LocalObject): Promise<void>
    delete(objectId: string, indexerURL: string): Promise<void>
    countForFile(fileId: string): Promise<number>
  }
  tags: {
    syncFromMetadata(
      fileId: string,
      tagNames: string[] | undefined,
    ): Promise<void>
  }
  directories: {
    syncFromMetadata(
      fileId: string,
      directoryName: string | undefined,
    ): Promise<void>
  }
  platform: {
    getIndexerURL(): Promise<string>
    getAppKey(indexerURL: string): Promise<AppKeyRef | null>
    pinnedObjectToLocalObject(
      fileId: string,
      indexerURL: string,
      object: PinnedObjectRef,
    ): Promise<LocalObject>
    withTransaction(fn: () => Promise<void>): Promise<void>
  }
  hooks: {
    onBatchChanged(): Promise<void>
    onFileDeleted(fileRecord: FileRecordRow): Promise<void>
    onFileUpdated(fileId: string): void
    onProgress(
      counts: Counts & { isSyncing: boolean; cursorAt?: number },
    ): void
  }
}

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
  deps: SyncDownDeps,
  getCursor: () => Promise<ObjectsCursor | undefined>,
  setCursor: (cursor: ObjectsCursor | undefined) => Promise<void>,
): Promise<number | void> {
  logger.debug('syncDownEvents', 'tick')

  const counts: Counts = {
    existing: 0,
    added: 0,
    deleted: 0,
  }

  let totalEventsFetched = 0

  while (true) {
    if (signal.aborted) break
    try {
      const cursor = await getCursor()
      logger.debug('syncDownEvents', 'syncing', {
        id: cursor?.id,
        after: cursor?.after,
      })

      const events = await deps.sdk.objectEvents(cursor, batchSize)
      totalEventsFetched += events.length

      if (totalEventsFetched > 1) {
        deps.hooks.onProgress({ isSyncing: true, ...counts })
      }

      // If the batch size is 1, we are probably synced and repeatedly polling the last event.
      if (events.length === 1) {
        logger.debug('syncDownEvents', 'batch', { size: events.length })
      } else {
        logger.info('syncDownEvents', 'batch', { size: events.length })
      }

      const prevTotal = counts.added + counts.deleted + counts.existing
      await processBatch(events, counts, signal, deps)
      const batchChanged =
        counts.added + counts.deleted + counts.existing > prevTotal

      // Update the cursor to the last event in the batch.
      const lastEvent = events[events.length - 1]
      const nextTimestamp = lastEvent ? lastEvent.updatedAt.getTime() + 1 : 0
      if (lastEvent) {
        await setCursor({
          id: lastEvent.id,
          after: new Date(nextTimestamp),
        })
      }

      // Update progress after each batch. Only report isSyncing when there are
      // real events to process (>1), not on the periodic heartbeat check which
      // returns a single cursor-marker event.
      deps.hooks.onProgress({
        ...counts,
        cursorAt: nextTimestamp,
        isSyncing: totalEventsFetched > 1,
      })
      if (batchChanged) {
        await deps.hooks.onBatchChanged()
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

  deps.hooks.onProgress({ isSyncing: false, ...counts })

  if (totalEventsFetched > 1) {
    return 0 // Zero interval — poll again immediately.
  }
}

async function processBatch(
  events: { id: string; object?: PinnedObjectRef; deleted?: boolean; updatedAt: Date }[],
  counts: Counts,
  signal: AbortSignal,
  deps: SyncDownDeps,
) {
  // Phase 1: Prepare — read DB state without holding any locks. Each event
  // is classified as create/update/delete/adopt based on whether a matching
  // file record exists and whether the remote ID differs from the local one.
  const prepared: PreparedEvent[] = []
  const indexerURL = await deps.platform.getIndexerURL()

  for (const { object, deleted, id } of events) {
    if (signal.aborted) return
    if (deleted) {
      const result = await prepareDelete(id, indexerURL, deps)
      if (result) prepared.push(result)
      continue
    }
    if (!object) continue
    const result = await prepareUpsert(id, object, indexerURL, deps)
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
  await deps.platform.withTransaction(async () => {
    for (const event of prepared) {
      try {
        switch (event.kind) {
          case 'create':
            await deps.files.create(event.fileRecord)
            await deps.localObjects.upsert(event.localObject)
            counts.added++
            break
          case 'update':
            await deps.files.update(event.fileRecord, {
              includeUpdatedAt: true,
            })
            await deps.localObjects.upsert(event.localObject)
            counts.existing++
            break
          case 'delete':
            // A file can have multiple objects (same file pinned to
            // multiple indexers, or duplicate pins from v1 migration).
            // Only delete the file record when no objects remain.
            await deps.localObjects.delete(event.objectId, event.indexerURL)
            if (
              (await deps.localObjects.countForFile(event.fileId)) === 0
            ) {
              await deps.files.delete(event.fileId)
              deletedFileIds.add(event.fileId)
              counts.deleted++
            }
            break
          case 'adopt':
            // Re-parent the object under the canonical file ID. The
            // target record may already exist from a previous adopt in
            // this batch (multiple objects sharing a file ID).
            await deps.localObjects.delete(event.objectId, event.indexerURL)
            if (
              (await deps.localObjects.countForFile(event.oldFileId)) === 0
            ) {
              await deps.files.delete(event.oldFileId)
            }
            if (await deps.files.read(event.fileRecord.id)) {
              await deps.files.update(event.fileRecord, {
                includeUpdatedAt: true,
              })
              counts.existing++
            } else {
              await deps.files.create(event.fileRecord)
              counts.added++
            }
            await deps.localObjects.upsert(event.localObject)
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
  // upload state for updated records, sync tags. Errors here are non-fatal.
  for (const event of prepared) {
    if (event.kind === 'delete' && deletedFileIds.has(event.fileId)) {
      try {
        await deps.hooks.onFileDeleted(event.fileRecord)
      } catch (e) {
        logger.error('syncDownEvents', 'cleanup_error', {
          error: e as Error,
        })
      }
    } else if (event.kind === 'update') {
      deps.hooks.onFileUpdated(event.fileId)
    }
    // Sync tags and directories from remote metadata for file records.
    if (event.kind !== 'delete' && event.isFile) {
      const shouldSync =
        event.kind === 'create' ||
        event.kind === 'adopt' ||
        (event.kind === 'update' && event.isRemoteNewer)
      if (shouldSync) {
        try {
          await deps.tags.syncFromMetadata(event.fileRecord.id, event.tags)
        } catch (e) {
          logger.error('syncDownEvents', 'tag_sync_error', {
            fileId: event.fileRecord.id,
            error: e as Error,
          })
        }
        try {
          await deps.directories.syncFromMetadata(
            event.fileRecord.id,
            event.directory,
          )
        } catch (e) {
          logger.error('syncDownEvents', 'directory_sync_error', {
            fileId: event.fileRecord.id,
            error: e as Error,
          })
        }
      }
    }
  }
}

async function prepareDelete(
  id: string,
  indexerURL: string,
  deps: SyncDownDeps,
): Promise<PreparedDelete | null> {
  try {
    const existingFileRecord = await deps.files.readByObjectId(id, indexerURL)
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

/**
 * Classify an upsert event as create, update, or adopt.
 *
 * Lookup order:
 *   1. By metadata.id (v1 canonical ID) — fast path for v1 metadata.
 *   2. By objectId+indexerURL — fallback for v0 metadata (no id field).
 *
 * If a file record is found by objectId but its local ID differs from the
 * remote metadata.id, this is an "adopt" — another device assigned a
 * canonical ID that this device should adopt.
 */
async function prepareUpsert(
  id: string,
  object: PinnedObjectRef,
  indexerURL: string,
  deps: SyncDownDeps,
): Promise<PreparedCreate | PreparedUpdate | PreparedAdopt | null> {
  try {
    const metadata = decodeFileMetadata(object.metadata())
    if (hasCompleteThumbnailMetadata(metadata)) {
      let existingThumbnail: FileRecord | null = null
      if (metadata.id) {
        existingThumbnail = await deps.files.read(metadata.id)
      }
      if (!existingThumbnail) {
        const byObjectId = await deps.files.readByObjectId(id, indexerURL)
        if (byObjectId) {
          if (metadata.id && metadata.id !== byObjectId.id) {
            return prepareAdopt(
              id,
              byObjectId,
              indexerURL,
              object,
              metadata,
              deps,
            )
          }
          existingThumbnail = byObjectId
        }
      }
      // v0 thumbnails lack thumbForId. We don't resolve thumbForHash here
      // because multiple files can share the same hash, making the parent
      // ambiguous. The v0 device that created the thumbnail knows the
      // correct pairing — when it upgrades, migration 0004 resolves it
      // locally and syncUp pushes the correct thumbForId. Until then,
      // the thumbnail is stored but invisible (syncUp skips thumbnails
      // without thumbForId).
      if (!metadata.thumbForId) {
        metadata.kind = 'thumb'
      }
      return prepareFileRecord(
        'thumbnail',
        existingThumbnail,
        indexerURL,
        object,
        metadata,
        deps,
      )
    }
    if (hasCompleteFileMetadata(metadata)) {
      let existingFile: FileRecord | null = null
      if (metadata.id) {
        existingFile = await deps.files.read(metadata.id)
      }
      if (!existingFile) {
        const byObjectId = await deps.files.readByObjectId(id, indexerURL)
        if (byObjectId) {
          if (metadata.id && metadata.id !== byObjectId.id) {
            return prepareAdopt(
              id,
              byObjectId,
              indexerURL,
              object,
              metadata,
              deps,
            )
          }
          existingFile = byObjectId
        }
      }
      return prepareFileRecord(
        'file',
        existingFile,
        indexerURL,
        object,
        metadata,
        deps,
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
  metadata: DecodedFileMetadata,
  deps: SyncDownDeps,
): Promise<PreparedCreate | PreparedUpdate> {
  const existing = existingFile

  if (existing) {
    if (type === 'file') {
      logger.debug('syncDownEvents', 'file_update', { hash: existing.hash })
    } else {
      logger.debug('syncDownEvents', 'thumbnail_update', {
        thumbForId: existing.thumbForId,
      })
    }
    const localObject = await deps.platform.pinnedObjectToLocalObject(
      existing.id,
      indexerURL,
      object,
    )
    // v0 downgrade detection: incoming metadata has no id but the existing
    // record has a v1 id. This happens when a pre-v1 node overwrites the
    // indexer object — it writes back all fields it knows but strips v1-only
    // fields (version, id, kind, thumbForId) that it doesn't understand.
    //
    // Strategy: accept v0-compatible changes (name, size, type, etc.) so
    // renames and other edits from v0 nodes propagate, but preserve v1-only
    // fields from the existing record. Set updatedAt = Date.now() to ensure
    // it moves past the syncUp cursor, triggering syncUp to push repaired
    // v1 metadata back to the indexer.
    //
    // This does NOT cause loops: after syncUp pushes, the resulting syncDown
    // event is v1 (has id) so it takes the normal merge path. The normal
    // merge produces the same updatedAt, and the syncUp cursor is already
    // past it, so no re-trigger occurs.
    const isV0Downgrade = !metadata.id && !!existing.id
    let mergedMetadata: Partial<
      Omit<FileRecordRow, 'id' | 'localId' | 'addedAt'>
    >
    if (metadata.updatedAt >= existing.updatedAt) {
      mergedMetadata = isV0Downgrade
        ? toV0SafeFileRecordFields(metadata, existing)
        : toFileRecordFields(metadata)
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

  const fileId = metadata.id || uniqueId()
  if (type === 'file') {
    logger.info('syncDownEvents', 'file_create', { hash: metadata.hash })
  } else {
    logger.info('syncDownEvents', 'thumbnail_create', {
      thumbForId: metadata.thumbForId,
    })
  }
  const localObject = await deps.platform.pinnedObjectToLocalObject(
    fileId,
    indexerURL,
    object,
  )
  const fileRecord: FileRecordRow = {
    ...toFileRecordFields(metadata),
    id: fileId,
    localId: null,
    addedAt: Date.now(),
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

/**
 * Prepare an adopt event: the remote metadata.id differs from the local
 * file record's ID. This happens during v0→v1 migration when another
 * device assigned a canonical ID first, or during subsequent ID
 * reassignments. The local file record and its objects are re-parented
 * under the canonical ID, preserving localId and addedAt.
 */
async function prepareAdopt(
  objectId: string,
  oldFile: FileRecord,
  indexerURL: string,
  object: PinnedObjectRef,
  metadata: DecodedFileMetadata,
  deps: SyncDownDeps,
): Promise<PreparedAdopt> {
  logger.info('syncDownEvents', 'id_adopt', {
    oldId: oldFile.id,
    newId: metadata.id,
    objectId,
  })
  const fileId = metadata.id || uniqueId()
  const localObject = await deps.platform.pinnedObjectToLocalObject(
    fileId,
    indexerURL,
    object,
  )
  const fileRecord: FileRecordRow = {
    ...toFileRecordFields(metadata),
    id: fileId,
    localId: oldFile.localId,
    addedAt: oldFile.addedAt,
  }
  return {
    kind: 'adopt',
    oldFileId: oldFile.id,
    objectId,
    fileRecord,
    localObject,
    indexerURL,
    tags: metadata.tags,
    directory: metadata.directory,
    isFile: metadata.kind === 'file',
  }
}

/** Map decoded metadata to file record fields (all v1 fields preserved). */
function toFileRecordFields(
  metadata: DecodedFileMetadata,
): Omit<FileRecordRow, 'id' | 'localId' | 'addedAt'> {
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
  }
}

/**
 * Build file record fields from v0 metadata, preserving v1-only fields
 * (kind, thumbForId) from the existing record. Accepts v0-compatible
 * changes like name, size, type, hash, and timestamps.
 *
 * updatedAt is set to max(now, incoming, existing) + 1 to guarantee:
 *   1. It advances past the syncUp cursor (which may be far ahead if
 *      other files were synced later — a simple +1 on old values fails).
 *   2. It's strictly greater than the remote metadata's updatedAt so
 *      syncUp's isLocalNewer check passes even if the v0 node's clock
 *      was ahead.
 * This does NOT cause loops: after syncUp pushes the repaired v1 event,
 * syncDown's normal merge produces the same updatedAt, and the cursor
 * is already past it.
 */
function toV0SafeFileRecordFields(
  metadata: DecodedFileMetadata,
  existing: FileRecordRow,
): Omit<FileRecordRow, 'id' | 'localId' | 'addedAt'> {
  return {
    name: metadata.name,
    type: metadata.type,
    kind: existing.kind,
    size: metadata.size,
    hash: metadata.hash,
    createdAt: metadata.createdAt,
    updatedAt: Math.max(Date.now(), metadata.updatedAt, existing.updatedAt) + 1,
    thumbForId: existing.thumbForId,
    thumbSize: metadata.thumbSize,
  }
}
