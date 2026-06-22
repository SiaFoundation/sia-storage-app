import {
  DB_OPTIMIZE_INTERVAL,
  PRUNE_SLABS_INTERVAL,
  SYNC_EVENTS_INTERVAL,
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
  THUMBNAIL_SCANNER_INTERVAL,
  TRASH_AUTO_PURGE_INTERVAL,
} from '@siastorage/core/config'
import { ServiceScheduler } from '@siastorage/core/lib/serviceInterval'
import { LOG_ROTATION_INTERVAL, runLogRotation } from '@siastorage/core/services'
import { runPruneSlabs } from '@siastorage/core/services/pruneSlabs'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import { syncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { ThumbnailScanner } from '@siastorage/core/services/thumbnailScanner'
import type { CliApp } from '../app'

/** Builds and starts every background service the daemon runs on a timer. */
export function initializeScheduler(app: CliApp): { scheduler: ServiceScheduler } {
  const scheduler = new ServiceScheduler()
  const thumbnailScanner = new ThumbnailScanner()
  thumbnailScanner.initialize(app.service)

  /** Skips the worker tick when the SDK isn't connected to an indexer. */
  function whenConnected<T>(
    fn: (signal: AbortSignal) => T | undefined,
  ): (signal: AbortSignal) => T | undefined {
    return (signal) => (app.service.connection.getState().isConnected ? fn(signal) : undefined)
  }

  const intervals = [
    {
      name: 'syncDownEvents',
      interval: SYNC_EVENTS_INTERVAL,
      worker: whenConnected((signal) => syncDownEventsBatch(signal, app.service, app.internal)),
    },
    {
      name: 'syncUpMetadata',
      interval: SYNC_UP_METADATA_INTERVAL,
      worker: whenConnected((signal) =>
        syncUpMetadataBatch(
          SYNC_UP_METADATA_BATCH_SIZE,
          SYNC_UP_METADATA_CONCURRENCY,
          signal,
          app.service,
          app.internal,
        ),
      ),
    },
    {
      name: 'thumbnailScanner',
      interval: THUMBNAIL_SCANNER_INTERVAL,
      worker: async (signal: AbortSignal) => {
        await thumbnailScanner.runScan(signal)
      },
    },
    {
      name: 'dbOptimize',
      interval: DB_OPTIMIZE_INTERVAL,
      worker: () => app.service.optimize(),
    },
    {
      name: 'trashAutoPurge',
      interval: TRASH_AUTO_PURGE_INTERVAL,
      worker: () => app.service.files.autoPurgeWithCleanup(),
    },
    {
      name: 'pruneSlabs',
      interval: PRUNE_SLABS_INTERVAL,
      worker: whenConnected(() => runPruneSlabs(app.service, app.internal)),
    },
    {
      name: 'logRotation',
      interval: LOG_ROTATION_INTERVAL,
      worker: () => runLogRotation(app.service),
    },
  ]

  for (const config of intervals) {
    scheduler.createInterval(config).init()
  }

  return { scheduler }
}
