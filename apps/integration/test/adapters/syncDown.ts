import type { AppKeyRef, DatabaseAdapter } from '@siastorage/core/adapters'
import {
  countLocalObjectsForFile,
  deleteLocalObjectById,
  insertFileRecord,
  insertLocalObject,
  readFileRecord,
  readFileRecordByObjectId,
  syncDirectoryFromMetadata,
  syncTagsFromMetadata,
  updateFileRecordFields,
} from '@siastorage/core/db/operations'
import { sealPinnedObject } from '@siastorage/core/lib/localObjects'
import type { SyncDownDeps } from '@siastorage/core/services/syncDownEvents'
import type { MockSdk } from '@siastorage/sdk-mock'

export function buildSyncDownDeps(params: {
  db: DatabaseAdapter
  sdk: MockSdk
  appKey: AppKeyRef
  indexerURL: string
  connected: () => boolean
}): SyncDownDeps {
  const { db, sdk, appKey, indexerURL } = params
  return {
    sdk: {
      objectEvents: (cursor, limit) => sdk.objectEvents(cursor, limit),
    },
    files: {
      read: (id) => readFileRecord(db, id),
      readByObjectId: (objectId, url) =>
        readFileRecordByObjectId(db, objectId, url),
      create: (record) => insertFileRecord(db, record),
      update: (record, options) => updateFileRecordFields(db, record, options),
    },
    localObjects: {
      upsert: (lo) => insertLocalObject(db, lo),
      delete: (objectId, url) => deleteLocalObjectById(db, objectId, url),
      countForFile: (fileId) => countLocalObjectsForFile(db, fileId),
    },
    tags: {
      syncFromMetadata: (fileId, tagNames) =>
        syncTagsFromMetadata(db, fileId, tagNames),
    },
    directories: {
      syncFromMetadata: (fileId, dirName) =>
        syncDirectoryFromMetadata(db, fileId, dirName),
    },
    platform: {
      getIndexerURL: async () => indexerURL,
      getAppKey: async () => appKey,
      pinnedObjectToLocalObject: async (fileId, url, object) =>
        sealPinnedObject(fileId, url, object, appKey),
      withTransaction: (fn) => db.withTransactionAsync(fn),
    },
    hooks: {
      onBatchChanged: async () => {},
      onFileDeleted: async () => {},
      onFileUpdated: () => {},
      onProgress: () => {},
    },
  }
}
