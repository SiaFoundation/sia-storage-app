import {
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
} from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { runSyncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { z } from 'zod'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import { readDirectoryNameForFile } from '../stores/directories'
import { readAllFileRecords, readAllFileRecordsCount } from '../stores/files'
import { getIsConnected, getPinnedObject, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import {
  getIsSyncingUpMetadata,
  setSyncUpMetadataState,
} from '../stores/syncUpMetadata'
import { readTagNamesForFile } from '../stores/tags'

type SyncUpCursor = {
  updatedAt: number
  id: string
}

const syncUpCursorCodec = z.codec(
  z.object({
    updatedAt: z.number(),
    id: z.string(),
  }),
  z.object({
    updatedAt: z.number(),
    id: z.string(),
  }),
  {
    decode: (stored) => stored,
    encode: (domain) => domain,
  },
)

export async function getSyncUpCursor(): Promise<SyncUpCursor | undefined> {
  return getAsyncStorageJSON('syncUpCursor', syncUpCursorCodec)
}

export async function setSyncUpCursor(
  value: SyncUpCursor | undefined,
): Promise<void> {
  await setAsyncStorageJSON('syncUpCursor', value, syncUpCursorCodec)
}

export async function resetSyncUpCursor(): Promise<void> {
  await setSyncUpCursor(undefined)
}

export async function runSyncUpMetadata(
  batchSize: number,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveSignal = signal ?? new AbortController().signal
  return runSyncUpMetadataBatch(
    batchSize,
    SYNC_UP_METADATA_CONCURRENCY,
    effectiveSignal,
    {
      sdk: {
        getPinnedObject,
        updateObjectMetadata: async (pinnedObject) => {
          const sdk = getSdk()
          if (!sdk) throw new Error('SDK not initialized')
          await sdk.updateObjectMetadata(pinnedObject)
        },
      },
      files: {
        readAll: readAllFileRecords,
        readAllCount: readAllFileRecordsCount,
      },
      tags: { readNamesForFile: readTagNamesForFile },
      directories: { readNameForFile: readDirectoryNameForFile },
      platform: { isConnected: getIsConnected, getIndexerURL },
      hooks: {
        onProgress: (state) => {
          if (state.isSyncing && state.processed) {
            setSyncUpMetadataState((s) => ({
              ...state,
              processed: (s.processed ?? 0) + state.processed!,
            }))
          } else {
            setSyncUpMetadataState(state)
          }
        },
        getIsSyncing: getIsSyncingUpMetadata,
      },
    },
    getSyncUpCursor,
    setSyncUpCursor,
  )
}

export const { init: initSyncUpMetadata } = createServiceInterval({
  name: 'syncUpMetadata',
  worker: async (signal) => {
    return runSyncUpMetadata(SYNC_UP_METADATA_BATCH_SIZE, signal)
  },
  getState: async () => true,
  interval: SYNC_UP_METADATA_INTERVAL,
})
