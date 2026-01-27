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
// Slab data capacity = SECTOR_SIZE × total shards.
export const SLAB_SIZE =
  SECTOR_SIZE * (UPLOAD_DATA_SHARDS + UPLOAD_PARITY_SHARDS)
// Packer idle timeout - flush partial slab after this delay.
export const PACKER_IDLE_TIMEOUT = secondsInMs(5)
// Minimum slab fill percentage before allowing flush (0.0 - 1.0).
// Prevents flushing when we could pack more efficiently.
export const SLAB_FILL_THRESHOLD = 0.9
// Scan only if queued uploads are less than this factor times the max transfers.
export const SCANNER_MAX_TOTAL_UPLOADS_FACTOR = 2
// Max amount of files to add to the queue each scan as a factor of the max transfers.
export const SCANNER_ADD_TO_QUEUE_FACTOR = 2
// Scan interval.
export const SCANNER_INTERVAL = secondsInMs(5) // 5 seconds
// Sync events interval.
export const SYNC_EVENTS_INTERVAL = secondsInMs(10) // 10 seconds
// Sync new photos interval.
export const SYNC_NEW_PHOTOS_INTERVAL = secondsInMs(30) // 30 seconds
// Sync archive photos interval.
export const SYNC_PHOTOS_ARCHIVE_INTERVAL = secondsInMs(5) // 5 seconds
// Thumbnail scanner interval.
export const THUMBNAIL_SCANNER_INTERVAL = secondsInMs(5) // 5 seconds
// Maximum number of bytes to retain in the local file system before evicting.
export const FS_MAX_BYTES = 1_000_000_000 // 1 GB
// File system orphaned file cleanup frequency.
export const FS_ORPHAN_FREQUENCY = daysInMs(7) // 7 days
// File system file eviction frequency.
export const FS_EVICTION_FREQUENCY = minutesInMs(60) // 60 minutes
// Age threshold for considering files evictable.
export const FS_EVICTABLE_MIN_AGE = daysInMs(7) // 7 days
// Sync up metadata interval.
export const SYNC_UP_METADATA_INTERVAL = secondsInMs(10) // 10 seconds
// Sync up metadata batch size.
export const SYNC_UP_METADATA_BATCH_SIZE = 500 // 500 files
// Auto-download threshold for shared file imports.
export const SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD = 5 * 1024 * 1024 // 5 MB
