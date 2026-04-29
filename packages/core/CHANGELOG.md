## 0.0.6 (2026-04-29)

### Features

- `runCacheEviction` now accepts an `AbortSignal` and checks it between batches and between rows, so iOS suspension can drain the loop cleanly before the DB gate closes.
- SlotPool.acquire() and SlotPool.withSlot() accept an optional AbortSignal so cancelled waiters release their queue position immediately. downloads.downloadFile() now registers the entry synchronously before the first DB read so cancel() arriving during initial metadata lookup is honored.
- `runOrphanScanner` now accepts an `AbortSignal` and checks it between batches and between rows, so iOS suspension can drain the loop cleanly before the DB gate closes.
- createSuspensionManager owns BG-task lifecycle via setAppState, registerBackgroundTask, releaseBackgroundTask, and getRunningBackgroundTaskIds; background work uses a native AbortController so signal.aborted cancels the poll loop at any await boundary.
- Add `queryTrashedCachedFiles` and `queryNonCurrentCachedFiles` DB ops, the matching `app.fs.trashedCachedFiles` and `app.fs.nonCurrentCachedFiles` facade methods, and the `FS_EVICTABLE_MIN_AGE_NON_CURRENT` config to back the new eviction pre-passes.
- Add isAbortError(e) and getErrorMessage(e) helpers at @siastorage/core/lib/errors for consistent handling of abort signals (DOMException and Error name='AbortError' variants) and error-message extraction across packages.
- Added downloads.downloadFromShareUrl(id, url) and removed register, update, remove, acquireSlot, releaseSlot from the public downloads API — the share-URL flow now runs entirely inside the downloads namespace with the same cancel() / cancelAll() semantics and abortable slot-queue waits as downloadFile().
- Imported files are evictable from the local cache as soon as they're uploaded, instead of after the standard 1-day LRU grace.
- A brief toast appears when imported files replace existing ones as new versions.
- Added optional log forwarding under Settings → Advanced — every log entry is sent as NDJSON to a user-supplied HTTP endpoint with optional Bearer auth, and resumes from a saved cursor after offline gaps.
- Upgraded react-native-sia to 0.13.21: shard-based upload progress and a pull-based SDK download handle.
- Add shares namespace to AppService facade for resolving, previewing, pinning, and creating share URLs.
- Cache eviction now runs three passes: trashed files that have already been backed up are evicted immediately, superseded file versions past `FS_EVICTABLE_MIN_AGE_NON_CURRENT` (default 1 hour), then LRU only while the cache is over `FS_MAX_BYTES`. Thumbnails of current files are never evicted, and local-only files (no indexer object) are never evicted in any pass.
- SlotPool.acquire() accepts { priority, maxQueueDepth } options. Lower priority numbers are served first; same-priority waiters are LIFO; when maxQueueDepth is set, inserting past that many same-priority waiters evicts the oldest with AbortError.

### Fixes

- Pause uploads and the photo import scanner while the initial library sync is in progress, so sync-down isn't competing with the upload pipeline for the JS thread and the database.
- Add raceWithTimeout helper and fix a pending-timer leak in the suspension manager's phase 4 DB drain.
- Consolidate active-record filter helpers into a single `buildRecordFilter` with explicit opt-in flags; no behavior change.
- Exclude encrypted metadata and signature columns from default object queries; full objects are loaded on demand for upload and download paths.
- Library and device stat counts now match the visible library, excluding superseded file versions and thumbnails of files no longer in the library.
- Extend the suspension manager with phase 4/5 timing and a time-boxed db.close(), add UploadManager.getDiagnostics() and SuspensionAdapters.uploader.getDiagnostics for suspend-time snapshots, and make AppService.optimize() also run wal_checkpoint(PASSIVE) and return { walFrames, checkpointed, busy }.
- Scheduler-driven services that hold a DB handle now accept an AbortSignal so workers exit at loop boundaries before the suspension gate closes.
- Resolve directories and tags in bulk during sync-down, replacing per-row lookups with a single SELECT and a bulk INSERT OR IGNORE per batch. Significantly speeds up large initial syncs.
- Sync-down now applies all of each batch's database writes (files, objects, directories, tags, current-version) in a single transaction, so a mid-batch failure rolls back cleanly and the same batch retries on the next sync cycle. Filesystem cleanup and cache invalidations still run after the transaction commits.
- Sync-up metadata progress now accumulates across batches instead of being overwritten by the current batch size on each tick, so the status sheet counts up smoothly toward the total instead of stalling at the batch size.

## 0.0.5 (2026-04-17)

### Features

- Add debounced cache invalidation API to SWR cache helpers. Batch upload operations now use single bulk invalidation instead of per-item cascades.
- Split import scanner into two targeted queries and add BackoffTracker for exponential backoff on transiently-failing files.
- Add import status screen showing files in retry backoff and permanently lost files.
- Add `createSuspensionManager` with dependency-injected adapters for scheduler, uploader, and DB lifecycle.

### Fixes

- Distinguish temporarily unavailable assets from permanently deleted ones in the import scanner.
- Filter out files without hashes at the SQL level in upload manager polling.

## 0.0.4 (2026-04-13)

### Features

- Exclude slabs from default object queries for faster reads. Add getForFileWithSlabs for callers that need slab data.

### Fixes

- Add operation-level batching for unbounded SQL queries (auto-purge, delete lost files, delete directory) to keep memory bounded and yield to the event loop between batches.
- Standardized DB operation naming for consistency and clarity.
- Standardized and fixed SQL filters across file queries.

## 0.0.3 (2026-04-06)

### Features

- Batch sync-down processing replaces per-event DB lookups with bulk reads and writes, significantly improving initial sync speed.
- Add bulk file record operations for batch reads, upserts, tombstoning, and deletion by object IDs.
- Add file versioning support. Files with the same name and directory are treated as versions with the latest shown in the library. Moving or trashing a file operates on all versions.
- Add nested directory support with path-based tree structure and intermediate directory creation.
- Show a full-screen sync progress overlay when catching up with remote changes from other devices.

### Fixes

- Buffer log entries in memory and flush to the database every 2 seconds in a single transaction.
- Directory names, tag names, and file versioning are now case-sensitive. Search remains case-insensitive.
- Include tags and directory in file metadata during upload so other devices see the full folder and tag assignments immediately after sync-down.
- Trashing a file now cancels its pending upload, preventing stale upload entries from inflating progress calculations.
- Run PRAGMA optimize on startup, after sync, after bulk imports, and on a 60-second interval to keep SQLite query planner statistics fresh.
- Update default indexer URL from app.sia.storage to sia.storage.

## 0.0.2 (2026-03-10)

### Fixes

- Extract adapter implementations into reusable packages.
