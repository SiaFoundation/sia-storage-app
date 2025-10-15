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
import { PinnedObjectInterface, type ObjectsCursor } from 'react-native-sia'
import { createServiceInterval } from '../lib/serviceInterval'
import { z } from 'zod'
import { getSecureStoreJSON, setSecureStoreJSON } from '../stores/secureStore'
import { isoToEpochCodec } from '../encoding/date'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { upsertLocalObject } from '../stores/localObjects'
import { removeFromCache } from '../stores/fileCache'
import { extFromMime } from '../lib/fileTypes'

const batchSize = 100

/**
 * Syncs down events from the indexer to the local database. The service works by
 * starting with a cursor saved in secure store. The service will sync down the next
 * batch of events and save the cursor to secure store. If there are no events to
 * sync, the cursor is reset. The service checks if files are already in the database
 * by object id. The service runs a batch every SYNC_EVENTS_INTERVAL milliseconds.
 */
async function syncDownEvents(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.log('[syncDownEvents] not connected to indexer, skipping sync')
    return
  }
  try {
    const sdk = getSdk()
    if (!sdk) {
      logger.log('[syncDownEvents] no sdk, skipping sync')
      return
    }
    const indexerURL = await getIndexerURL()
    const cursor = await getSyncDownCursor()
    logger.log('[syncDownEvents] syncing batch', cursor)
    let existingCount = 0
    let newCount = 0
    let deletedCount = 0
    const events = await sdk.objects(cursor, batchSize)
    if (events.length === 0) {
      logger.log('[syncDownEvents] no events to sync, resetting cursor')
      await setSyncDownCursor(undefined)
      return
    }
    logger.log(`[syncDownEvents] batch size=${events.length}`)
    for (const { object, deleted, key } of events) {
      if (deleted) {
        try {
          logger.log(`[syncDownEvents] deleting object key=${key}`)
          const result = await handleDeleteEvent(key)
          deletedCount += result.deletedCount
        } catch (e) {
          logger.log('[syncDownEvents] error handling deletion for key', key, e)
        }
        continue
      }

      // If the object is not deleted this will always be defined.
      if (!object) continue

      try {
        logger.log(`[syncDownEvents] updating object key=${key}`)
        const result = await handleUpdateEvent(object, indexerURL)
        existingCount += result.existingCount
        newCount += result.newCount
      } catch (e) {
        logger.log('[syncDownEvents] error handling update for key', key, e)
      }
    }

    logger.log(
      `[syncDownEvents] synced, existingCount=${existingCount}, newCount=${newCount}, deletedCount=${deletedCount}`
    )

    const lastEvent = events.find((event) => event.object?.updatedAt())
    if (events.length === batchSize && lastEvent) {
      await setSyncDownCursor({
        key: lastEvent.key,
        after: lastEvent.object?.updatedAt() ?? new Date(),
      })
    } else {
      await setSyncDownCursor(undefined)
    }
  } catch (e) {
    logger.log('[syncDownEvents] sync error', e)
  }
}

async function handleDeleteEvent(
  key: string
): Promise<{ deletedCount: number }> {
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
    return { deletedCount: 1 }
  }
  return { deletedCount: 0 }
}

async function handleUpdateEvent(
  object: PinnedObjectInterface,
  indexerURL: string
): Promise<{ existingCount: number; newCount: number }> {
  const metadata = decodeFileMetadata(object.metadata())
  const fileId = metadata.id
  if (!fileId) {
    logger.log('[syncDownEvents] no file id in metadata, skipping update')
    return { existingCount: 0, newCount: 0 }
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
    return { existingCount: 1, newCount: 0 }
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
    return { existingCount: 0, newCount: 1 }
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
