import { daysInMs, minutesInMs, secondsInMs } from '../lib/time'

// App key, used to identify itself to the indexer. 32 bytes hex string.
export const APP_KEY =
  'ac38d91cfb250d50820a0c658628662b8c2dcfc6a5f3fe4d5755eb0a7b67eeac'
// Default indexer.
export const DEFAULT_INDEXER_URL = 'https://app.sia.storage'
// Max concurrent uploads.
export const DEFAULT_MAX_UPLOADS = 1
// Max concurrent downloads.
export const DEFAULT_MAX_DOWNLOADS = 2
// Max inflight per download.
export const DOWNLOAD_MAX_INFLIGHT = 15
// Max inflight per upload.
export const UPLOAD_MAX_INFLIGHT = 15
// Data shards for uploads.
export const UPLOAD_DATA_SHARDS = 10
// Parity shards for uploads.
export const UPLOAD_PARITY_SHARDS = 20
// Sia protocol constant: sector size in bytes (4 MiB).
export const SECTOR_SIZE = 4 * 1024 * 1024
// Slab data capacity = SECTOR_SIZE × data shards.
export const SLAB_SIZE = SECTOR_SIZE * UPLOAD_DATA_SHARDS
// Packer idle timeout - flush partial slab after this delay.
export const PACKER_IDLE_TIMEOUT = secondsInMs(10)
// Max batch duration before forcing flush (limits time data is unpinned).
export const PACKER_MAX_BATCH_DURATION = secondsInMs(60)
// Max slabs before forcing flush (limits unpinned data, ~400 MiB at 10 slabs).
export const PACKER_MAX_SLABS = 10
// Minimum slab fill percentage before allowing flush (0.0 - 1.0).
// Prevents flushing when we could pack more efficiently.
export const SLAB_FILL_THRESHOLD = 0.9
// Packer DB poll interval.
export const PACKER_POLL_INTERVAL = secondsInMs(5) // 5 seconds
// Sync events interval.
export const SYNC_EVENTS_INTERVAL = secondsInMs(10) // 10 seconds
// Sync new photos interval.
export const SYNC_NEW_PHOTOS_INTERVAL = secondsInMs(10) // 10 seconds
// Sync archive photos interval.
export const SYNC_PHOTOS_ARCHIVE_INTERVAL = secondsInMs(5) // 5 seconds
// Resume fetching archive photos when pending local-only bytes drop below this threshold.
export const SYNC_ARCHIVE_RESUME_THRESHOLD = 4 * SLAB_SIZE
// Minimum interval between bounded recent re-scans of the archive.
export const SYNC_ARCHIVE_RECENT_SCAN_INTERVAL = minutesInMs(180) // 3 hours
// How far back the bounded recent re-scan walks.
export const SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK = daysInMs(14) // 14 days
// Thumbnail scanner interval.
export const THUMBNAIL_SCANNER_INTERVAL = secondsInMs(5) // 5 seconds
// Maximum number of bytes to retain in the local file system before evicting.
export const FS_MAX_BYTES = 1_000_000_000 // 1 GB
// File system orphaned file cleanup frequency.
export const FS_ORPHAN_FREQUENCY = daysInMs(1) // 1 day
// File system file eviction frequency.
export const FS_EVICTION_FREQUENCY = minutesInMs(60) // 60 minutes
// Age threshold for considering files evictable.
export const FS_EVICTABLE_MIN_AGE = daysInMs(7) // 7 days
// Sync up metadata interval.
export const SYNC_UP_METADATA_INTERVAL = secondsInMs(10) // 10 seconds
// Sync up metadata batch size.
export const SYNC_UP_METADATA_BATCH_SIZE = 500 // 500 files
// Sync up metadata concurrency.
export const SYNC_UP_METADATA_CONCURRENCY = 30
// Auto-download threshold for shared file imports.
export const SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD = 5 * 1024 * 1024 // 5 MB
// Auto-purge trashed files older than this threshold.
export const TRASH_AUTO_PURGE_AGE = daysInMs(30) // 30 days
// How often to check for trashed files to auto-purge.
export const TRASH_AUTO_PURGE_INTERVAL = minutesInMs(60) // 60 minutes
// Performance monitor logging interval.
export const PERF_MONITOR_INTERVAL = secondsInMs(15)
// Max concurrent pinObject calls during save phase.
export const SAVE_BATCH_CONCURRENCY = 20
// Delay before removing upload state after save, so cache invalidation
// propagates and the UI transitions directly from uploading to uploaded.
export const SAVE_REMOVAL_DELAY_MS = 500
