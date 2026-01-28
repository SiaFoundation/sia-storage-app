import type {
  ObjectEvent,
  ObjectsCursor,
  PinnedObjectInterface,
} from 'react-native-sia'
import { z } from 'zod'
import { SYNC_EVENTS_INTERVAL } from '../config'
import { isoToEpochCodec } from '../encoding/date'
import {
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { uniqueId } from '../lib/uniqueId'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import {
  createFileRecordWithLocalObject,
  deleteFileRecord,
  type FileMetadata,
  type FileRecord,
  readFileRecordByContentHash,
  readFileRecordByObjectId,
  updateFileRecordWithLocalObject,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getAutoSyncDownEvents, getIndexerURL } from '../stores/settings'
import { removeTempDownloadFile } from '../stores/tempFs'
import { readThumbnailRecordByThumbForHashAndSize } from '../stores/thumbnails'
import { cancelUpload } from '../stores/uploads'

const batchSize = 100

type Counts = {
  existing: number
  deleted: number
  added: number
}

/**
 * Syncs down events from the indexer to the local database. The service works by
 * starting with a cursor saved in secure store. It iterates until there are no
 * more events to sync and saves the cursor to secure store after each batch.
 * The service runs again every SYNC_EVENTS_INTERVAL milliseconds.
 */
export async function syncDownEvents(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.debug('syncDownEvents', 'not connected to indexer, skipping sync')
    return
  }
  const sdk = getSdk()
  if (!sdk) {
    logger.debug('syncDownEvents', 'no sdk, skipping sync')
    return
  }

  const counts = {
    existing: 0,
    added: 0,
    deleted: 0,
  }

  while (true) {
    try {
      const cursor = await getSyncDownCursor()
      logger.debug(
        'syncDownEvents',
        `syncing from id=${cursor?.id} after=${cursor?.after}`,
      )

      const events = await sdk.objectEvents(cursor, batchSize)

      // If the batch size is 1, we are probably synced and repeatedly polling the last event.
      if (events.length === 1) {
        logger.debug(
          'syncDownEvents',
          `batch size=${events.length}, no new events found`,
        )
      } else {
        logger.info('syncDownEvents', `batch size=${events.length}`)
      }

      await processBatch(events, counts)

      // Update the cursor to the last event in the batch.
      const lastEvent = events[events.length - 1]
      const nextTimestamp = lastEvent ? lastEvent.updatedAt.getTime() + 1 : 0
      if (lastEvent) {
        await setSyncDownCursor({
          id: lastEvent.id,
          after: new Date(nextTimestamp),
        })
      }

      // If the batch is not full, we're done for now.
      if (events.length < batchSize) {
        break
      }
    } catch (e) {
      logger.error('syncDownEvents', 'sync error', e)
      break
    }
  }

  logger.info(
    'syncDownEvents',
    `synced, existingCount=${counts.existing}, addedCount=${counts.added}, deletedCount=${counts.deleted}`,
  )
}

async function processBatch(events: ObjectEvent[], counts: Counts) {
  for (const { object, deleted, id } of events) {
    if (deleted) {
      await handleDeleteEvent(id, counts)
      continue
    }

    // If the object is not deleted this will always be defined.
    if (!object) continue

    await handleUpdateEvent(id, object, counts)
  }
}

async function handleDeleteEvent(id: string, counts: Counts): Promise<void> {
  try {
    const existingFileRecord = await readFileRecordByObjectId(id)
    if (existingFileRecord) {
      logger.info('syncDownEvents', `deleting file id=${existingFileRecord.id}`)
      await Promise.all([
        // Remove the file from the file system.
        removeFsFile(existingFileRecord),
        // Remove any temporary download file.
        removeTempDownloadFile(existingFileRecord),
        // Remove the file from the database.
        deleteFileRecord(existingFileRecord.id),
      ])
      counts.deleted++
    } else {
      logger.debug(
        'syncDownEvents',
        `no file record found for object id=${id}, skipping delete`,
      )
    }
  } catch (e) {
    logger.error('syncDownEvents', `error handling delete for id=${id}`, e)
    throw e
  }
}

async function handleUpdateEvent(
  id: string,
  object: PinnedObjectInterface,
  counts: Counts,
): Promise<void> {
  try {
    const indexerURL = await getIndexerURL()
    const metadata = decodeFileMetadata(object.metadata())
    if (hasCompleteThumbnailMetadata(metadata)) {
      const existingThumbnail = await readThumbnailRecordByThumbForHashAndSize(
        metadata.thumbForHash!,
        metadata.thumbSize!,
      )
      await handleFileRecord(
        'thumbnail',
        existingThumbnail,
        indexerURL,
        object,
        metadata,
        counts,
      )
      return
    }
    if (hasCompleteFileMetadata(metadata)) {
      const existingFile = await readFileRecordByContentHash(metadata.hash)
      await handleFileRecord(
        'file',
        existingFile,
        indexerURL,
        object,
        metadata,
        counts,
      )
      return
    }
    logger.debug('syncDownEvents', 'incomplete metadata, skipping update')
  } catch (e) {
    logger.error('syncDownEvents', `error handling update for id=${id}`, e)
    throw e
  }
}

async function handleFileRecord(
  type: 'file' | 'thumbnail',
  existingFile: FileRecord | null,
  indexerURL: string,
  object: PinnedObjectInterface,
  metadata: FileMetadata,
  counts: Counts,
) {
  if (existingFile) {
    if (type === 'file') {
      logger.debug('syncDownEvents', `updating file hash=${existingFile.hash}`)
    } else {
      logger.debug(
        'syncDownEvents',
        `updating thumbnail thumbForHash=${existingFile.thumbForHash}`,
      )
    }
    const localObject = await pinnedObjectToLocalObject(
      existingFile.id,
      indexerURL,
      object,
    )
    await updateFileRecordWithLocalObject(
      {
        ...existingFile,
        ...(metadata.updatedAt >= existingFile.updatedAt ? metadata : {}),
      },
      localObject,
      { includeUpdatedAt: true },
    )
    // Cancel any inflight upload for this file since we now have a pinned object.
    cancelUpload(existingFile.id)
    counts.existing++
  } else {
    if (type === 'file') {
      logger.info('syncDownEvents', `creating file hash=${metadata.hash}`)
    } else {
      logger.info(
        'syncDownEvents',
        `creating thumbnail thumbForHash=${metadata.thumbForHash}`,
      )
    }
    const fileId = uniqueId()
    const localObject = await pinnedObjectToLocalObject(
      fileId,
      indexerURL,
      object,
    )
    await createFileRecordWithLocalObject(
      {
        id: fileId,
        ...metadata,
        localId: null,
        addedAt: Date.now(),
      },
      localObject,
    )
    counts.added++
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
  logger.info('syncDownEvents', 'resetting sync down cursor')
  await setSyncDownCursor(undefined)
}
