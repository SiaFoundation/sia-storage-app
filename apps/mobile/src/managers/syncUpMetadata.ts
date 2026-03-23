import {
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
} from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { syncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { logger } from '@siastorage/logger'
import { app, internal } from '../stores/appService'

export async function runSyncUpMetadata(
  batchSize: number,
  signal?: AbortSignal,
): Promise<void> {
  const effectiveSignal = signal ?? new AbortController().signal
  return syncUpMetadataBatch(
    batchSize,
    SYNC_UP_METADATA_CONCURRENCY,
    effectiveSignal,
    app(),
    internal(),
  )
}

async function run(signal: AbortSignal): Promise<void> {
  if (app().sync.getState().isSyncingDown) {
    logger.debug('syncUpMetadata', 'skipped', { reason: 'syncing_down' })
    return
  }
  return runSyncUpMetadata(SYNC_UP_METADATA_BATCH_SIZE, signal)
}

export const { init: initSyncUpMetadata } = createServiceInterval({
  name: 'syncUpMetadata',
  worker: run,
  interval: SYNC_UP_METADATA_INTERVAL,
})
