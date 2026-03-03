import { logger } from '@siastorage/logger'
import type { AppKeyRef, ObjectsCursor, PinnedObjectRef } from '../adapters/sdk'
import type { LocalObject } from '../encoding/localObject'
import {
  type FileMetadata,
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
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

type PreparedEvent = PreparedCreate | PreparedUpdate | PreparedDelete

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
  // is classified as create/update/delete based on whether a matching
  // file record exists.
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
            await deps.localObjects.delete(event.objectId, event.indexerURL)
            if (!event.fileRecord.deletedAt) {
              const now = Date.now()
              await deps.files.update(
                {
                  id: event.fileId,
                  deletedAt: now,
                  trashedAt: event.fileRecord.trashedAt ?? now,
                },
                { includeUpdatedAt: false },
              )
            }
            if (
              (await deps.localObjects.countForFile(event.fileId)) === 0
            ) {
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

async function prepareUpsert(
  id: string,
  object: PinnedObjectRef,
  indexerURL: string,
  deps: SyncDownDeps,
): Promise<PreparedCreate | PreparedUpdate | null> {
  try {
    const metadata = decodeFileMetadata(object.metadata())
    if (hasCompleteThumbnailMetadata(metadata)) {
      const existingThumbnail = await deps.files.read(metadata.id)
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
      const existingFile = await deps.files.read(metadata.id)
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
  metadata: FileMetadata,
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
