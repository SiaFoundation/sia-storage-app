import type {
  ObjectEvent,
  ObjectsCursor,
  PinnedObjectInterface,
} from 'react-native-sia'
import { z } from 'zod'
import { SYNC_EVENTS_INTERVAL } from '../config'
import { withTransactionLock } from '../db'
import { isoToEpochCodec } from '../encoding/date'
import {
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
import type { LocalObject } from '../encoding/localObject'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { uniqueId } from '../lib/uniqueId'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import {
  createFileRecord,
  deleteFileRecord,
  type FileMetadata,
  type FileRecord,
  readFileRecordByContentHash,
  readFileRecordByObjectId,
  updateFileRecord,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'
import { upsertLocalObject } from '../stores/localObjects'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getAutoSyncDownEvents, getIndexerURL } from '../stores/settings'
import { removeTempDownloadFile } from '../stores/tempFs'
import { readThumbnailRecordByThumbForHashAndSize } from '../stores/thumbnails'
import { removeUpload } from '../stores/uploads'

const batchSize = 500

type Counts = {
  existing: number
  deleted: number
  added: number
}

type PreparedCreate = {
  kind: 'create'
  fileRecord: Omit<FileRecord, 'objects'>
  localObject: LocalObject
}

type PreparedUpdate = {
  kind: 'update'
  fileRecord: Omit<FileRecord, 'objects'>
  localObject: LocalObject
  fileId: string
}

type PreparedDelete = {
  kind: 'delete'
  fileId: string
  fileRecord: Omit<FileRecord, 'objects'>
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
export async function syncDownEvents(): Promise<number | void> {
  logger.debug('syncDownEvents', 'tick')
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'not_connected' })
    return
  }
  const sdk = getSdk()
  if (!sdk) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'no_sdk' })
    return
  }

  const counts = {
    existing: 0,
    added: 0,
    deleted: 0,
  }

  let totalEventsFetched = 0

  while (true) {
    try {
      const cursor = await getSyncDownCursor()
      logger.debug('syncDownEvents', 'syncing', {
        id: cursor?.id,
        after: cursor?.after,
      })

      const events = await sdk.objectEvents(cursor, batchSize)
      totalEventsFetched += events.length

      // If the batch size is 1, we are probably synced and repeatedly polling the last event.
      if (events.length === 1) {
        logger.debug('syncDownEvents', 'batch', { size: events.length })
      } else {
        logger.info('syncDownEvents', 'batch', { size: events.length })
      }

      const prevTotal = counts.added + counts.deleted + counts.existing
      await processBatch(events, counts)
      const batchChanged =
        counts.added + counts.deleted + counts.existing > prevTotal

      // Update the cursor to the last event in the batch.
      const lastEvent = events[events.length - 1]
      const nextTimestamp = lastEvent ? lastEvent.updatedAt.getTime() + 1 : 0
      if (lastEvent) {
        await setSyncDownCursor({
          id: lastEvent.id,
          after: new Date(nextTimestamp),
        })
      }

      // Invalidate caches after each batch so the UI updates progressively.
      if (batchChanged) {
        await invalidateCacheLibraryAllStats()
        invalidateCacheLibraryLists()
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

  if (totalEventsFetched > 1) {
    return 0 // Zero interval — poll again immediately.
  }
}

type BatchDedup = {
  byContentHash: Map<string, Omit<FileRecord, 'objects'>>
  byThumbKey: Map<string, Omit<FileRecord, 'objects'>>
}

async function processBatch(events: ObjectEvent[], counts: Counts) {
  // Phase 1: Prepare (no locks held)
  const prepared: PreparedEvent[] = []
  const dedup: BatchDedup = {
    byContentHash: new Map(),
    byThumbKey: new Map(),
  }

  for (const { object, deleted, id } of events) {
    if (deleted) {
      const result = await prepareDelete(id)
      if (result) prepared.push(result)
      continue
    }
    if (!object) continue
    const result = await prepareUpsert(id, object, dedup)
    if (result) prepared.push(result)
  }

  if (prepared.length === 0) return

  // Phase 2: Commit (single transaction, per-event error handling)
  await withTransactionLock(async () => {
    for (const event of prepared) {
      try {
        switch (event.kind) {
          case 'create':
            await createFileRecord(event.fileRecord, false)
            await upsertLocalObject(event.localObject, false)
            counts.added++
            break
          case 'update':
            await updateFileRecord(event.fileRecord, false, {
              includeUpdatedAt: true,
            })
            await upsertLocalObject(event.localObject, false)
            counts.existing++
            break
          case 'delete':
            await deleteFileRecord(event.fileId, false)
            counts.deleted++
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

  // Phase 3: Cleanup (errors are non-fatal)
  for (const event of prepared) {
    if (event.kind === 'delete') {
      try {
        await Promise.all([
          removeFsFile(event.fileRecord),
          removeTempDownloadFile(event.fileRecord),
        ])
      } catch (e) {
        logger.error('syncDownEvents', 'cleanup_error', {
          error: e as Error,
        })
      }
    } else if (event.kind === 'update') {
      removeUpload(event.fileId)
    }
  }
}

async function prepareDelete(id: string): Promise<PreparedDelete | null> {
  try {
    const existingFileRecord = await readFileRecordByObjectId(id)
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
      fileId: existingFileRecord.id,
      fileRecord: existingFileRecord,
    }
  } catch (e) {
    logger.error('syncDownEvents', 'delete_error', { id, error: e as Error })
    throw e
  }
}

async function prepareUpsert(
  id: string,
  object: PinnedObjectInterface,
  dedup: BatchDedup,
): Promise<PreparedCreate | PreparedUpdate | null> {
  try {
    const indexerURL = await getIndexerURL()
    const metadata = decodeFileMetadata(object.metadata())
    if (hasCompleteThumbnailMetadata(metadata)) {
      const existingThumbnail = await readThumbnailRecordByThumbForHashAndSize(
        metadata.thumbForHash!,
        metadata.thumbSize!,
      )
      return prepareFileRecord(
        'thumbnail',
        existingThumbnail,
        indexerURL,
        object,
        metadata,
        dedup,
      )
    }
    if (hasCompleteFileMetadata(metadata)) {
      const existingFile = await readFileRecordByContentHash(metadata.hash)
      return prepareFileRecord(
        'file',
        existingFile,
        indexerURL,
        object,
        metadata,
        dedup,
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
  object: PinnedObjectInterface,
  metadata: FileMetadata,
  dedup: BatchDedup,
): Promise<PreparedCreate | PreparedUpdate> {
  let inBatch: Omit<FileRecord, 'objects'> | undefined
  if (!existingFile) {
    inBatch = dedup.byContentHash.get(metadata.hash)
    if (!inBatch && metadata.thumbForHash && metadata.thumbSize) {
      inBatch = dedup.byThumbKey.get(
        `${metadata.thumbForHash}:${metadata.thumbSize}`,
      )
    }
  }
  const existing = existingFile || inBatch

  if (existing) {
    if (type === 'file') {
      logger.debug('syncDownEvents', 'file_update', { hash: existing.hash })
    } else {
      logger.debug('syncDownEvents', 'thumbnail_update', {
        thumbForHash: existing.thumbForHash,
      })
    }
    const localObject = await pinnedObjectToLocalObject(
      existing.id,
      indexerURL,
      object,
    )
    return {
      kind: 'update',
      fileRecord: {
        ...existing,
        ...(metadata.updatedAt >= existing.updatedAt ? metadata : {}),
      },
      localObject,
      fileId: existing.id,
    }
  }

  if (type === 'file') {
    logger.info('syncDownEvents', 'file_create', { hash: metadata.hash })
  } else {
    logger.info('syncDownEvents', 'thumbnail_create', {
      thumbForHash: metadata.thumbForHash,
    })
  }
  const fileId = uniqueId()
  const localObject = await pinnedObjectToLocalObject(
    fileId,
    indexerURL,
    object,
  )
  const fileRecord: Omit<FileRecord, 'objects'> = {
    id: fileId,
    ...metadata,
    localId: null,
    addedAt: Date.now(),
  }
  dedup.byContentHash.set(metadata.hash, fileRecord)
  if (metadata.thumbForHash && metadata.thumbSize) {
    dedup.byThumbKey.set(
      `${metadata.thumbForHash}:${metadata.thumbSize}`,
      fileRecord,
    )
  }
  return {
    kind: 'create',
    fileRecord,
    localObject,
  }
}

export const initSyncDownEvents = createServiceInterval({
  name: 'syncDownEvents',
  worker: syncDownEvents,
  getState: getAutoSyncDownEvents,
  interval: SYNC_EVENTS_INTERVAL,
})

// Persistent cursor saved for next batch.

const objectsCursorCodec = z.codec(
  z.object({
    // Accept both old `key` and new `id` format for migration
    id: z.string().optional(),
    key: z.string().optional(),
    after: z.number(),
  }),
  z.object({
    id: z.string(),
    after: z.date(),
  }),
  {
    decode: (stored) => ({
      id: stored.id ?? stored.key ?? '',
      after: isoToEpochCodec.decode(stored.after),
    }),
    encode: (cursor) => ({
      id: cursor.id,
      after: isoToEpochCodec.encode(cursor.after),
    }),
  },
)

export async function getSyncDownCursor(): Promise<ObjectsCursor | undefined> {
  const decoded = await getAsyncStorageJSON(
    'syncDownCursor',
    objectsCursorCodec,
  )
  // Return undefined if no valid id (handles migration edge cases)
  if (!decoded || !decoded.id) return undefined
  return decoded
}

export async function setSyncDownCursor(value: ObjectsCursor | undefined) {
  await setAsyncStorageJSON('syncDownCursor', value, objectsCursorCodec)
}

export async function resetSyncDownCursor() {
  logger.info('syncDownEvents', 'cursor_reset')
  await setSyncDownCursor(undefined)
}
