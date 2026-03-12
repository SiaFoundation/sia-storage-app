import { isoToEpochCodec } from '@siastorage/core'
import { SYNC_EVENTS_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import { logger } from '@siastorage/logger'
import type { ObjectsCursor } from 'react-native-sia'
import { z } from 'zod'
import { db } from '../db'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import { syncDirectoryFromMetadata } from '../stores/directories'
import {
  createFileRecord,
  readFileRecord,
  readFileRecordByObjectId,
  updateFileRecord,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'
import {
  countLocalObjectsForFile,
  deleteLocalObject,
  upsertLocalObject,
} from '../stores/localObjects'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getAutoSyncDownEvents, getIndexerURL } from '../stores/settings'
import { setSyncDownState } from '../stores/syncDown'
import { syncTagsFromMetadata } from '../stores/tags'
import { removeTempDownloadFile } from '../stores/tempFs'
import { removeUpload } from '../stores/uploads'

export async function syncDownEvents(
  signal: AbortSignal,
): Promise<number | void> {
  if (!getIsConnected()) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'not_connected' })
    return
  }
  const sdk = getSdk()
  if (!sdk) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'no_sdk' })
    return
  }

  return syncDownEventsBatch(
    signal,
    {
      sdk: {
        objectEvents: (cursor, limit) => sdk.objectEvents(cursor, limit),
      },
      files: {
        read: readFileRecord,
        readByObjectId: readFileRecordByObjectId,
        create: (record) => createFileRecord(record, false),
        update: (record, options) => updateFileRecord(record, false, options),
      },
      localObjects: {
        upsert: (lo) => upsertLocalObject(lo, false),
        delete: (oid, url) => deleteLocalObject(oid, url, false),
        countForFile: countLocalObjectsForFile,
      },
      tags: { syncFromMetadata: syncTagsFromMetadata },
      directories: { syncFromMetadata: syncDirectoryFromMetadata },
      platform: {
        getIndexerURL,
        getAppKey: () => {
          throw new Error('not implemented')
        },
        pinnedObjectToLocalObject,
        withTransaction: (fn: () => Promise<void>) =>
          db().withTransactionAsync(fn),
      },
      hooks: {
        onBatchChanged: async () => {
          invalidateCacheLibraryAllStats()
          invalidateCacheLibraryLists()
        },
        onFileDeleted: async (fr) => {
          await Promise.all([removeFsFile(fr), removeTempDownloadFile(fr)])
        },
        onFileUpdated: removeUpload,
        onProgress: (counts) => setSyncDownState(counts),
      },
    },
    getSyncDownCursor,
    setSyncDownCursor,
  )
}

export const { init: initSyncDownEvents, triggerNow: triggerSyncDownEvents } =
  createServiceInterval({
    name: 'syncDownEvents',
    worker: syncDownEvents,
    getState: getAutoSyncDownEvents,
    interval: SYNC_EVENTS_INTERVAL,
  })

const objectsCursorCodec = z.codec(
  z.object({
    id: z.string().optional(),
    after: z.number(),
  }),
  z.object({
    id: z.string(),
    after: z.date(),
  }),
  {
    decode: (stored) => ({
      id: stored.id ?? '',
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
