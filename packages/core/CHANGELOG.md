## 0.0.18 (2026-06-26)

### Features

- Replace the sync-up watermark cursor with a per-object needsSyncUp dirty flag. Sync-up now pushes only changed objects, fixing both the redundant re-pushes after a large sync-down and the race where an edit could slip past the advancing cursor and never sync.

### Fixes

- Moving or permanently deleting a file now affects its entire version history, not just the current version, so older versions no longer get left behind in the original folder.
- Remove the `maxInflight` transfer-concurrency option from the SDK adapter and the `DOWNLOAD_MAX_INFLIGHT`/`UPLOAD_MAX_INFLIGHT` config constants. Transfer concurrency is now managed by the SDK.

## 0.0.17 (2026-06-10)

### Fixes

- Generate photo and video thumbnails natively, so rotated photos preview upright across formats and platforms.

## 0.0.16 (2026-06-05)

### Fixes

- File sizes now reflect the real file length. The size read at import is often wrong on Android; it's corrected to the real on-disk size after copy, then again from the size the SDK reports when the upload finishes, and any already-wrong sizes heal as files sync down.
- The launch sync screen now stays hidden when it detects a catch-up is mostly file migrations rather than new files, so returning users don't wait through it.
- Upload only current versions. Superseded versions and their thumbnails are no longer uploaded, matching the upload stats counts which already track current versions only.

## 0.0.15 (2026-05-21)

### Features

- Add empty directory cleanup operation with cascading parent deletion and sync-down integration. `queryDirectoryChildren` and `queryAllDirectoriesWithCounts` now report `fileCount` recursively (this directory plus all descendants), so a parent that holds files only in subdirectories shows the total instead of zero.
- Logging dispatches each entry to a registry of appenders. Available sinks: a console appender (logger pkg), a Node file appender (node-adapters), and a SQLite appender (`DbLogAppender` in core). Remote log shipping is a separate service that reads from the `logs` table — its toggle does not affect local persistence. Appenders support `pause` / `resume` for iOS suspension and a synchronous pre-suspend RAM flush.

### Fixes

- Batch thumbnail-size lookups in the scanner from one query per candidate to one per page.
- Add MIME and extension support for many more video (AVI, MKV, WebM, 3GP, MPEG, WMV, FLV, OGV), image (BMP, AVIF, JXL, HEIC sequence, AVCI, PSD, Canon/Nikon/Sony/Fuji/Olympus/Panasonic/Pentax RAW), audio (FLAC, OGG, Opus, AIFF, CAF, AMR, WMA, MIDI), Office/iWork/OpenDocument, ebook, archive, and installer formats, plus YAML, TOML, and common source-code extensions that resolve to `text/plain`.
- Fixed an upload race that could leave some files unsynced. Helps with https://github.com/SiaFoundation/sia-storage-app/issues/688.
- Fixed an issue where file status indicators showed a "Database is suspended" error after the app was backgrounded during an upload or download.
- Fixed picker imports occasionally getting permanently marked as "File unavailable" right after a successful import. The import scanner could race the background copy and mark just-inserted placeholders lost before their bytes had landed.
- Import scanner re-checks the fs row before marking a placeholder lost, and clears any stale "lost" reason when a file is successfully hashed.
- Fix the import scanner re-selecting `lostReason`-marked placeholders on every tick, which caused a cascade of library-cache invalidations. `FileQueryOpts` gains a `lostReasonIsNull` flag used by the scanner's phase 2 query; successful finalize clears `lostReason` so a recovered row can leave the Unavailable tab.
- `queryLibrary` now returns an `fsExists` flag per row via LEFT JOIN, and the file-list fetcher primes the per-fileId fs URI cache. List-row `useFsFileUri` hooks no longer fan out into one SELECT + `RNFS.stat` per visible row.
- `queryLibrary` now returns an `isFavorite` flag per row via LEFT JOIN, and the file-list fetcher primes the per-fileId favorites cache. List-row `useIsFavorite` hooks no longer fan out into one `SELECT FROM file_tags` per visible row.
- Recognize files by their magic bytes instead of trusting a misleading filename extension, so a `.heic`-named file that's actually JPEG is identified as JPEG everywhere `type` is surfaced.
- Detect AVI, MKV, FLAC, OGG, AIFF, 7z, bzip2, xz, RAR, ZIP, and gzip from magic bytes so files with missing or wrong extensions still resolve to the correct MIME instead of `application/octet-stream`.
- `ServiceScheduler.triggerNow()` no longer drops requests that arrive while a tick is running — the request defers to fire immediately after the in-flight tick completes.
- Fixed iOS suspend-time races that could leave an upload, sync-up, download, import, thumbnail, or share-sheet add half-applied.
- Reduced battery use during idle gallery viewing by skipping thumbnail-scanner work for files whose originals aren't yet downloaded and slowing the scanner's polling cadence after several quiet ticks.
- Thumbnail generation is now faster and uses less memory, especially when processing many images at once.
- The thumbnail scanner now self-heals files whose recorded type disagrees with their actual content: the file is renamed on disk and the record updated, so other devices receive the fix on the next sync.
- The thumbnail scanner now consults a `thumbnailableTypes` allowlist declared by each adapter, skipping formats the platform can't decode (proprietary RAW, JPEG XL, PSD, SVG, HEIC sequence, TIFF on mobile) instead of retrying on every cold start.

## 0.0.14 (2026-05-12)

### Fixes

- Fixed an issue where sync-down dropped events when a same-millisecond cluster of indexer events spanned a batch boundary.

## 0.0.13 (2026-05-07)

### Features

- Add `files.getByNameInDirectoryPath` facade method, `uploader.currentBatch` introspection, and `APP_META` config constant.
- Add `directoryId` option to `files.createMany` / `insertManyFiles` to file inserted records into a directory atomically.

## 0.0.12 (2026-05-04)

### Fixes

- Upload status pill now reflects the current upload batch instead of library-wide totals, so the percent actually advances during uploads.
- Treat iOS `inactive` AppState as a foreground sub-state (per Apple's docs) so SWR data fetches keep running through transient interruptions like notification banners and Face ID prompts instead of pausing.
- Made iOS foreground/background event handling more deterministic by centralizing AppState reading and emitting transitions in a single fixed order.

## 0.0.11 (2026-05-03)

### Fixes

- Fixed an iOS crash that could occur when the app was suspended while a database operation was in flight.

## 0.0.10 (2026-05-02)

### Fixes

- Fixed iOS RunningBoard 0xDEAD10CC crashes by releasing the background-task assertion before the suspension wind-down, and removed the now-unused DB drain/close pipeline (DELETE-mode SQLite handles uncleanly-suspended connections without intervention).

## 0.0.9 (2026-05-02)

### Fixes

- Made the log appender's stop non-blocking and moved scheduler pause/abort before suspend pre-work, so iOS suspension no longer stalls on a DB flush behind still-ticking services.
- Made the import scanner and thumbnail scanner exit fast on suspend abort even when a large file is mid hash, copy, or thumbnail generation.

## 0.0.8 (2026-05-01)

### Fixes

- Fixed iOS background-transition crashes caused by races in SQLite handle teardown and query pile-up at the suspend boundary.
- Made the remote log forwarder's stop non-blocking and skipped its ticker entirely when no remote endpoint is configured, so iOS suspension no longer waits on an in-flight log POST.
- Tightened the iOS background-suspension cleanup budget and added a self-deadline to background tasks so cleanup completes inside the task's allotted wake window instead of racing iOS's expiration callback.
- Fixed an issue where the app could be stuck on the onboarding screen for a signed-in user until it was minimized and reopened.
- Made the upload manager's suspend non-blocking so iOS suspension completes faster when the upload loop is mid-iteration.

## 0.0.7 (2026-04-30)

### Features

- Stop LogForwarder HTTP shipping ticker on suspend so it doesn't compete with the DB drain.
- Add `onForegroundActive` optional hook to `createSuspensionManager`. Fires synchronously on every `setAppState('foreground')` call, including no-op calls — covers the case where the manager is already resumed (e.g. by a BG task) and the user subsequently foregrounds, where `onAfterResume` does not fire.

### Fixes

- Preserve the sync gate across suspension aborts so it stays up until sync actually completes.

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
