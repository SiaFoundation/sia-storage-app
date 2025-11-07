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
// Scan only if queued uploads are less than this factor times the max transfers.
export const SCANNER_MAX_TOTAL_UPLOADS_FACTOR = 2
// Max amount of files to add to the queue each scan as a factor of the max transfers.
export const SCANNER_ADD_TO_QUEUE_FACTOR = 2
// Scan interval.
export const SCANNER_INTERVAL = 5_000 // 5 seconds
// Sync events interval.
export const SYNC_EVENTS_INTERVAL = 10_000 // 10 seconds
// Sync new photos interval.
export const SYNC_NEW_PHOTOS_INTERVAL = 30_000 // 30 seconds
// Sync archive photos interval.
export const SYNC_PHOTOS_ARCHIVE_INTERVAL = 5_000 // 5 seconds
// Thumbnail interval.
export const THUMBNAIL_INTERVAL = 5_000 // 5 seconds
