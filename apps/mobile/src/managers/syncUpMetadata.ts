import {
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
} from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { runSyncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { app, internal } from '../stores/appService'

export async function runSyncUpMetadata(
  batchSize: number,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveSignal = signal ?? new AbortController().signal
  return runSyncUpMetadataBatch(
    batchSize,
    SYNC_UP_METADATA_CONCURRENCY,
    effectiveSignal,
    app(),
    internal(),
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
