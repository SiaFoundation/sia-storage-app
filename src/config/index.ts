// App key, used to identify itself to the indexer. 32 bytes hex string.
export const APP_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000'
// Default indexer.
export const DEFAULT_INDEXER_URL = 'https://app.sia.storage'
// Max concurrent transfers across all types.
export const DEFAULT_MAX_TRANSFERS = 2
// Max inflight per download.
export const DOWNLOAD_MAX_INFLIGHT = 15
// Max inflight per upload.
export const UPLOAD_MAX_INFLIGHT = 15
// Data shards for uploads.
export const UPLOAD_DATA_SHARDS = 10
// Parity shards for uploads.
export const UPLOAD_PARITY_SHARDS = 20
// Chunk size for uploads.
export const UPLOAD_CHUNK_SIZE = 1 * 1024 * 1024 // 1 MiB
// Scan only if queued uploads are less than this factor times the max transfers.
export const SCANNER_MAX_TOTAL_UPLOADS_FACTOR = 2
// Max amount of files to add to the queue each scan as a factor of the max transfers.
export const SCANNER_ADD_TO_QUEUE_FACTOR = 2
// Scan interval.
export const SCANNER_INTERVAL = 5_000 // 5 seconds
