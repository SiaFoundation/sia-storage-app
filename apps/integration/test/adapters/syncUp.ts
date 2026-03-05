import type { DatabaseAdapter } from '@siastorage/core/adapters'
import {
  countLocalObjectsForFile,
  deleteLocalObjectById,
  queryDirectoryNameForFile,
  queryFileRecords,
  queryFileRecordsCount,
  queryTagNamesForFile,
} from '@siastorage/core/db/operations'
import type { SyncUpDeps } from '@siastorage/core/services/syncUpMetadata'
import type { MockSdk } from '@siastorage/sdk-mock'

export function buildSyncUpDeps(params: {
  db: DatabaseAdapter
  sdk: MockSdk
  indexerURL: string
  connected: () => boolean
}): SyncUpDeps {
  const { db, sdk, connected } = params
  return {
    sdk: {
      getPinnedObject: (objectId) => sdk.getPinnedObject(objectId),
      updateObjectMetadata: (pinnedObject) =>
        sdk.updateObjectMetadata(pinnedObject),
      deleteObject: (objectId) => sdk.deleteObject(objectId),
    },
    files: {
      readAll: (opts) => queryFileRecords(db, opts),
      readAllCount: (opts) => queryFileRecordsCount(db, opts),
    },
    localObjects: {
      delete: (objectId, indexerURL) =>
        deleteLocalObjectById(db, objectId, indexerURL),
      countForFile: (fileId) => countLocalObjectsForFile(db, fileId),
    },
    tags: {
      readNamesForFile: (fileId) => queryTagNamesForFile(db, fileId),
    },
    directories: {
      readNameForFile: (fileId) => queryDirectoryNameForFile(db, fileId),
    },
    platform: {
      isConnected: () => connected(),
      getIndexerURL: async () => params.indexerURL,
    },
    hooks: {
      onProgress: () => {},
      getIsSyncing: () => false,
    },
  }
}
