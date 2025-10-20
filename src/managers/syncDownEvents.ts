import { logger } from '../lib/logger'
import { SYNC_EVENTS_INTERVAL } from '../config'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getAutoSyncDownEvents, getIndexerURL } from '../stores/settings'
import {
  createFileRecord,
  readFileRecord,
  readFileRecordByObjectId,
  updateFileRecord,
  deleteFileRecord,
} from '../stores/files'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import {
  ObjectEvent,
  PinnedObjectInterface,
  type ObjectsCursor,
} from 'react-native-sia'
import { createServiceInterval } from '../lib/serviceInterval'
import { z } from 'zod'
import { getSecureStoreJSON, setSecureStoreJSON } from '../stores/secureStore'
import { isoToEpochCodec } from '../encoding/date'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { upsertLocalObject } from '../stores/localObjects'
import { removeFromCache } from '../stores/fileCache'
import { extFromMime } from '../lib/fileTypes'

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
async function syncDownEvents(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.log('[syncDownEvents] not connected to indexer, skipping sync')
    return
  }
  const sdk = getSdk()
  if (!sdk) {
    logger.log('[syncDownEvents] no sdk, skipping sync')
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
      logger.log(
        `[syncDownEvents] syncing from key=${cursor?.key} after=${cursor?.after}`
      )

      const events = await sdk.objects(cursor, batchSize)

      logger.log(`[syncDownEvents] batch size=${events.length}`)
      await processBatch(events, counts)

      // Update the cursor to the last event in the batch.
      const lastEvent = events[events.length - 1]
      if (lastEvent) {
        await setSyncDownCursor({
          key: lastEvent.key,
          after: lastEvent.updatedAt,
        })
      }

      // If the batch is not full, we're done for now.
      if (events.length < batchSize) {
        break
      }
    } catch (e) {
      logger.log('[syncDownEvents] sync error', e)
    }
  }

  logger.log(
    `[syncDownEvents] synced, existingCount=${counts.existing}, addedCount=${counts.added}, deletedCount=${counts.deleted}`
  )
}

async function processBatch(events: ObjectEvent[], counts: Counts) {
  for (const { object, deleted, key } of events) {
    if (deleted) {
      try {
        logger.log(`[syncDownEvents] deleting object key=${key}`)
        await handleDeleteEvent(key, counts)
      } catch (e) {
        logger.log('[syncDownEvents] error handling deletion for key', key, e)
      }
      continue
    }

    // If the object is not deleted this will always be defined.
    if (!object) continue

    try {
      logger.log(`[syncDownEvents] updating object key=${key}`)
      await handleUpdateEvent(object, counts)
    } catch (e) {
      logger.log('[syncDownEvents] error handling update for key', key, e)
    }
  }
}

async function handleDeleteEvent(key: string, counts: Counts): Promise<void> {
  const existingFileRecord = await readFileRecordByObjectId(key)
  if (existingFileRecord) {
    await Promise.all([
      // Remove the file from the cache.
      removeFromCache(
        existingFileRecord.id,
        extFromMime(existingFileRecord.fileType)
      ),
      // Remove any tmp file from the cache.
      removeFromCache(existingFileRecord.id, '.tmp'),
      // Remove the file from the database.
      deleteFileRecord(existingFileRecord.id),
    ])
    counts.deleted++
  }
}

async function handleUpdateEvent(
  object: PinnedObjectInterface,
  counts: Counts
): Promise<void> {
  const indexerURL = await getIndexerURL()
  const metadata = decodeFileMetadata(object.metadata())
  const fileId = metadata.id
  if (!fileId) {
    logger.log('[syncDownEvents] no file id in metadata, skipping update')
    return
  }
  const existingFileRecord = await readFileRecord(fileId)
  if (existingFileRecord) {
    const localObject = await pinnedObjectToLocalObject(
      existingFileRecord.id,
      indexerURL,
      object
    )
    await updateFileRecord({
      ...existingFileRecord,
      ...decodeFileMetadata(object.metadata()),
    })
    await upsertLocalObject(localObject)
    counts.existing++
  } else {
    await createFileRecord({
      id: fileId,
      fileName: metadata.name ?? null,
      fileSize: metadata.size ?? null,
      createdAt: object.createdAt().getTime(),
      updatedAt: object.updatedAt().getTime(),
      fileType: metadata.fileType ?? null,
    })
    const localObject = await pinnedObjectToLocalObject(
      fileId,
      indexerURL,
      object
    )
    await upsertLocalObject(localObject)
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
    key: z.string(),
    after: z.number(),
  }),
  z.object({
    key: z.string(),
    after: z.date(),
  }),
  {
    decode: (stored) => ({
      key: stored.key,
      after: isoToEpochCodec.decode(stored.after),
    }),
    encode: (cursor) => ({
      key: cursor.key,
      after: isoToEpochCodec.encode(cursor.after),
    }),
  }
)

async function getSyncDownCursor(): Promise<ObjectsCursor | undefined> {
  const decoded = await getSecureStoreJSON('syncDownCursor', objectsCursorCodec)
  return decoded == null ? undefined : (decoded as unknown as ObjectsCursor)
}

export async function setSyncDownCursor(value: ObjectsCursor | undefined) {
  await setSecureStoreJSON('syncDownCursor', value, objectsCursorCodec)
}
