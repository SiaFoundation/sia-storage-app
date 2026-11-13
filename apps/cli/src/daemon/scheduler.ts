import {
  DB_OPTIMIZE_INTERVAL,
  FS_EVICTION_FREQUENCY_DAEMON,
  MOUNT_HINT_CHECK_INTERVAL,
  MOUNT_RESTORE_INTERVAL,
  PROVIDER_THUMBNAIL_RETRY_INTERVAL,
  PRUNE_SLABS_INTERVAL,
  SHARE_LINKS_INTERVAL,
  SYNC_EVENTS_INTERVAL,
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
  THUMBNAIL_SCANNER_INTERVAL,
  TRASH_AUTO_PURGE_INTERVAL,
} from '@siastorage/core/config'
import { ServiceScheduler } from '@siastorage/core/lib/serviceInterval'
import { LOG_ROTATION_INTERVAL, runLogRotation, runShareLinkSync } from '@siastorage/core/services'
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
      // Finder shows a plain icon for a file whose thumbnail failed to
      // download, and asks again only once a retry lands it.
      name: 'providerThumbnails',
      interval: PROVIDER_THUMBNAIL_RETRY_INTERVAL,
      worker: whenConnected((signal) => app.service.provider.retryThumbnails(signal)),
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
      name: 'shareLinks',
      interval: SHARE_LINKS_INTERVAL,
      worker: whenConnected(() => runShareLinkSync(app.service)),
    },
    {
      name: 'pruneSlabs',
      interval: PRUNE_SLABS_INTERVAL,
      worker: whenConnected(() => runPruneSlabs(app.service, app.internal)),
    },
    {
      // The configured cap and age. When the Finder folder also holds a file,
      // its copy and ours share disk blocks, so removing ours frees space only
      // once Finder drops its copy.
      name: 'cacheEviction',
      interval: FS_EVICTION_FREQUENCY_DAEMON,
      worker: async (signal: AbortSignal) => {
        await app.internal.evictCache(signal)
      },
    },
    {
      // The extension says when the system wrote files to disk or dropped
      // them. The pass reads Finder's files anyway, so this only shortens
      // how long the record of what Finder holds stays out of date.
      name: 'mountHint',
      interval: MOUNT_HINT_CHECK_INTERVAL,
      worker: (signal: AbortSignal) => app.internal.syncMountIfHinted(signal),
    },
    {
      // After the indexer is changed, a file only Finder holds has to come
      // back into the cache before it can upload to the new one.
      name: 'mountRestore',
      interval: MOUNT_RESTORE_INTERVAL,
      worker: whenConnected((signal: AbortSignal) => app.internal.restoreFromMount(signal)),
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
