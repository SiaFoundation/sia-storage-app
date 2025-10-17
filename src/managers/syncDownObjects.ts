import { logger } from '../lib/logger'
import { SYNC_OBJECTS_INTERVAL } from '../config'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getAutoSyncDownObjects, getIndexerURL } from '../stores/settings'
import { getAppKey } from '../lib/appKey'
import {
  createFileRecord,
  FileRecord,
  readFileRecord,
  readFileRecordByCid,
  updateFileRecord,
} from '../stores/files'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { uniqueId } from '../lib/uniqueId'
import { type ObjectsCursor } from 'react-native-sia'
import { createServiceInterval } from '../lib/serviceInterval'
import { z } from 'zod'
import { getSecureStoreJSON, setSecureStoreJSON } from '../stores/secureStore'
import { epochOrIsoToDate } from '../encoding'

const batchSize = 30

/**
 * Syncs down objects from the indexer to the local database. The service works by
 * starting with a cursor saved in secure store. The service will sync down the next
 * batch of objects and save the cursor to secure store. If there are no objects to
 * sync, the cursor is reset. The service checks if files are already in the database
 * by cid. The service runs a batch every SYNC_OBJECTS_INTERVAL milliseconds.
 */
async function syncDownObjects(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.log('[syncDownObjects] not connected to indexer, skipping sync')
    return
  }
  try {
    const sdk = getSdk()
    if (!sdk) {
      logger.log('[syncDownObjects] no sdk, skipping sync')
      return
    }
    const indexerURL = await getIndexerURL()
    const cursor = await getSyncDownCursor()
    logger.log('[syncDownObjects] syncing batch', cursor)
    let existingCount = 0
    let newCount = 0
    const objects = await sdk.objects(cursor, batchSize)
    if (objects.length === 0) {
      logger.log('[syncDownObjects] no objects to sync, resetting cursor')
      await setSyncDownCursor(undefined)
      return
    }
    for (const { object, deleted, key } of objects) {
      if (deleted) continue
      if (!object) continue
      const metadata = decodeFileMetadata(object.metadata())
      let existingFileRecord: FileRecord | null = null
      // Try to find the file record by id first.
      // This should always succeed.
      if (metadata.id) {
        existingFileRecord = await readFileRecord(metadata.id)
      }
      // If not found, try to find by cid.
      if (!existingFileRecord) {
        existingFileRecord = await readFileRecordByCid(key)
      }
      const sealedObject = object.seal(await getAppKey())
      if (existingFileRecord) {
        existingCount += 1
        try {
          updateFileRecord({
            ...existingFileRecord,
            sealedObjects: {
              ...existingFileRecord?.sealedObjects,
              [indexerURL]: sealedObject,
            },
          })
        } catch (e) {
          logger.log('[syncDownObjects] error updating file record', key, e)
        }
      } else {
        newCount += 1
        try {
          createFileRecord({
            id: uniqueId(),
            cid: key,
            fileName: metadata.name ?? null,
            fileSize: metadata.size ?? null,
            createdAt: object.createdAt().getTime(),
            fileType: metadata.fileType ?? null,
            sealedObjects: {
              [indexerURL]: sealedObject,
            },
          })
        } catch (e) {
          logger.log('[syncDownObjects] error adding file record', key, e)
        }
      }
    }
    logger.log('[syncDownObjects] synced', existingCount, 'existing objects')
    logger.log('[syncDownObjects] synced', newCount, 'new objects')
    await setSyncDownCursor({
      key: objects[objects.length - 1].key,
      after: objects[objects.length - 1].object?.updatedAt() ?? new Date(),
    })
  } catch (e) {
    logger.log('[syncDownObjects] sync error', e)
  }
}

export const initSyncDownObjects = createServiceInterval({
  name: 'syncDownObjects',
  worker: syncDownObjects,
  getState: getAutoSyncDownObjects,
  interval: SYNC_OBJECTS_INTERVAL,
})

// Persistent cursor saved for next batch.

const objectsCursorCodec = z.codec(
  z.object({
    key: z.string(),
    after: z.union([z.string(), z.number()]),
  }),
  z.object({
    key: z.string(),
    after: z.date(),
  }),
  {
    decode: (stored) => ({
      key: stored.key,
      after: epochOrIsoToDate.decode(stored.after),
    }),
    encode: (cursor) => ({
      key: cursor.key,
      after: epochOrIsoToDate.encode(cursor.after),
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
