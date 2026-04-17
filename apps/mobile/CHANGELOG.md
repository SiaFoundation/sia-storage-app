# Changelog

All notable changes to Sia Storage will be documented in this file.

## 1.10.0 (2026-04-17)

### Features

- Add import status screen showing files in retry backoff and permanently lost files.

### Fixes

- Add debounced cache invalidation API to SWR cache helpers. Batch upload operations now use single bulk invalidation instead of per-item cascades.
- Added a Delete Account entry in the Menu that opens the sia.storage account page where account deletion is performed.
- Distinguish temporarily unavailable assets from permanently deleted ones in the import scanner.
- Fixed a bug where missing files on iOS were not detected, blocking photo import and upload.
- File counts in the status sheet now include files pending import.
- Fixed background suspension draining services cleanly instead of rejecting their queries.
- Added a Help section in the Menu with links to Support, Report Content, Terms of Service, and Privacy Policy on sia.storage.

## 1.9.5 (2026-04-13)

### Fixes

- Exclude slabs from default object queries for faster reads. Add getForFileWithSlabs for callers that need slab data.
- Fixed background crashes (iOS 0xdead10cc) caused by SQLite file locks held during app suspension. The database now gates queries, drains in-flight operations, and checkpoints the WAL before closing.
- Fixed camera capture requesting photo library permission instead of camera permission.
- Fixed an issue where fresh installs would loop back to the welcome screen after completing onboarding.

## 1.9.4 (2026-04-09)

### Fixes

- Updated iOS permission purpose strings with detailed descriptions and concrete examples to comply with App Store Guideline 5.1.1(i). Removed unused photo library write permission.

## 1.9.3 (2026-04-08)

### Fixes

- Fixed iOS killing the app when backgrounded by closing the database connection before suspension to release SQLite WAL file locks.
- Raised general indexer connection timeouts to 20 seconds and registration timeout to 60 seconds to accommodate slower indexer cold starts.

## 1.9.2 (2026-04-07)

### Fixes

- Fixed app reset failing on upgrade when the database had not yet been created at the app group container path.

## 1.9.1 (2026-04-07)

### Fixes

- Fixed production builds using the dev app group container, causing a black screen on launch.

## 1.9.0 (2026-04-06)

### Features

- One-shot archive sync walks the photo library as a tight async loop with a modal showing scan progress. Import status icons distinguish queued vs active imports, and the library status sheet shows totals and sync progress.
- Add file versioning support. Files with the same name and directory are treated as versions with the latest shown in the library. Moving or trashing a file operates on all versions.
- File and folder lists now sort names naturally, so "file2" comes before "file10".
- Add nested folder browsing with breadcrumbs, subdirectory rows, subfolder creation, and tree navigation in the move-to-folder sheet.
- Files now appear in the library immediately when importing, with a "Processing" indicator while copying and hashing completes in the background.
- Show a full-screen sync progress overlay when catching up with remote changes from other devices.

### Fixes

- Added library size, usage, and storage details with descriptions to the indexer settings screen.
- Added TIFF file type support and excluded TIFF files from thumbnailing.
- Buffer log entries in memory and flush to the database every 2 seconds in a single transaction.
- Batch sync-down processing replaces per-event DB lookups with bulk reads and writes, significantly improving initial sync speed.
- Deferred cache invalidation during sync-down batch processing to avoid React re-render depth limits with large batches.
- Skip thumbnail scanning during sync-down since we don't yet know which thumbnails already exist.
- Directory names, tag names, and file versioning are now case-sensitive. Search remains case-insensitive.
- File viewer shows photos and videos from the media library for archive placeholders that haven't been imported yet.
- Fixed action sheet icons appearing vertically off-center relative to their text labels.
- Fixed batch upload progress not updating until after file data finished streaming to the network.
- Fixed duplicate SwitchIndexer screen name warning in navigation.
- Fixed manage tags and move to folder sheets not opening from file actions in some screens.
- Reduced native bridge calls when resolving file URIs.
- Fixed iOS out-of-memory crashes when hashing large files by patching react-native-fs to stream in 64KB chunks instead of loading the entire file into memory.
- Fixed label width clipping on narrow Android devices by using maxWidth instead of fixed width.
- Fixed exported logs missing structured data fields like taskType, invocationId, and filesRemaining.
- Fixed old photos appearing in recent sync after iOS background processing.
- Added forced version reset mechanism to auto-wipe local data on version upgrades.
- Pause uploads when account storage is full and automatically resume when space becomes available.
- Removed the unused QuickCrypto fallback path and the debug hash comparison screen.
- Duplicate detection during import now ignores trashed and deleted files.
- Import status icons distinguish queued, active, and failed imports. Library status sheet shows pending import count and active upload progress.
- Moved iOS database, file cache, and keychain items to app group shared container for extension support.
- Enabled WAL journal mode for the database.
- Run PRAGMA optimize on startup, after sync, after bulk imports, and on a 60-second interval to keep SQLite query planner statistics fresh.
- Surface errors from orphan and eviction scanners instead of swallowing them, and don't mark scans as successful when they fail.
- Display remaining app storage and show 'No app limit' when the storage limit is set to the max int64 value.
- Fixed concurrent orphan and eviction scans when multiple background tasks resume simultaneously.
- Skip heavy one-shot scanners in background tasks when the app is in the foreground.
- Eliminated a redundant file copy when importing via the document picker, halving import time for large files.
- Log a warning when database queries take longer than 500ms.
- Standardized skip conditions with debug logging across all periodic services.
- Removed synchronous file system calls used for log export.
- Raised cache eviction threshold from 1 GB to 4 GB and reduced minimum file age from 7 days to 1 day.
- Upgraded react-native-sia to 0.13.15, adding Account.remainingStorage and PinnedObject.encodedSize() APIs.
- Upgraded react-native-sia to 0.13.18.

## 1.8.2 (2026-03-18)

### Fixes

- Improved upload performance by parallelizing the save phase, batching state updates, and reducing progress-driven re-renders.
- Fixed significant lag caused by synchronous file system calls blocking the JS thread during background operations.
- The upload progress bar now shows for large files. It was previously hidden until the final slab.
- Upload progress now advances smoothly for multi-slab uploads.
- Fixed an issue where the wrong thumbnail could briefly display before the actual thumbnail was computed.
- Optimized thumbnail generation to decode each image fewer times using a batch adapter with size cascading and concurrent file processing.
- Reduced unnecessary gallery re-renders by debouncing cache invalidation and fixing memo comparators.

## 1.8.1 (2026-03-10)

### Fixes

- Replaced synchronous Expo FS calls with async RNFS APIs in hot-path file operations to reduce JS thread blocking.
- Empty folder and tag lists now show create buttons to quickly get started.
- Extract adapter implementations into reusable packages.
- The favorites system tag now displays a heart icon in the tags grid and screen header.
- Fixed Android auth browser closing with error due to background network restrictions killing SDK poll.
- Fixed Android expo-sqlite NullPointerException crashes by automatically recovering the database connection.
- Auto-capitalize folder and tag name inputs to "words" mode.
- Redesigned multi-select bar with count on the left and dynamic overflow action icons. Download and upload actions only appear when applicable. Consistent action labels across single and multi-select menus.
- Exit selection mode after completing bulk actions like move to folder or tag.
- Fixed keyboard briefly flashing when opening sheet modals by using the modal's onShow callback for input focus.
- Fixed maximum update depth exceeded error during photo sync caused by unstable SWR effect dependencies.
- Fixed noisy error logs from ph:// and content:// URIs during photo sync, and added MIME re-detection from local file when initial detection returns octet-stream.
- Fixed sheet overlay bug where transitioning between action sheet and folder picker could leave the screen unresponsive.
- Increased the status indicator size and removed the percentage from the badge.
- Fixed an issue where frequent new photos batches would trigger sync updates for the same files repeatedly.
- Fixed system tag detection using wrong prefix, which allowed rename and delete actions on system tags.
- Added success toast confirmations to all user-facing actions: create/rename/delete folders and tags, add/remove tags, toggle favorites, and move files to folders.
- Fixed uncaught promise rejections in UploadManager.
- Hide scroll bars on folder and tag lists.
- Improved onboarding flow with better auth timeout handling, offline resilience, and polished UI.
- Restyle folder rows from cards to simple rows with hairline separators.
- Tag and directory screens now show their respective icons in the header.
- Added a back button to the SearchScreen header for easier navigation.
- Improved thumbnail scanner rendering performance by batching cache invalidation and moving hashing off the JS thread.
- The file metadata tag editor now opens the same full-screen tag modal used by the selection bar.

## 1.8.0 (2026-03-03)

### Features

- Added the ability to rename tags and folders.
- Added a stay awake toggle in sync settings to keep the screen on during long syncs.
- Added trash and soft delete with cross-device sync support.
- Files not assigned to any folder now appear under a "No folder" entry in the files view.
- Reset database migrations and remove v0 metadata compatibility.

### Fixes

- Manually importing a file that already exists now shows a warning instead of silently blocking the import.
- Fixed carousel sort order for ADDED and SIZE sorts to match the gallery.
- Search input no longer auto-capitalizes text.
- Deleting a folder now moves its files to trash instead of permanently deleting them.
- Manually imported files are no longer automatically moved to the photo import directory.
- The media view now only shows images and videos, with filter options restricted to Photos and Videos.
- Fixed onboarding failing after app reinstall due to stale Keychain credentials from a previous install.
- Settings sub-pages use the standard back arrow instead of a custom header.
- Fixed the status spinner activating on every sync heartbeat even when there's nothing to sync.
- Removed "Remove from device" option from file action sheets.
- Removed https/sia URL scheme transforms now that the SDK returns sia:// links directly.
- Renamed "directories" to "folders" throughout the app for clearer terminology.

## 1.7.0 (2026-02-23)

### Features

- Added directories for organizing files into folders.
- Added search screen with tag-based filtering.
- Added tags for organizing files with favorites support.
- Reworked the library into three tabs: Files, Tags, and Media.
- Added per-view settings so each screen remembers its own sort, filter, and view mode.
- Fixed photo sync missing photos without EXIF creation timestamps by switching to modificationTime sorting, and added periodic background re-scans to catch cross-device synced photos arriving with old timestamps.

### Fixes

- Updated archive sync settings UI to show progress date from displayDate instead of numeric cursor.

## 1.6.0 (2026-02-20)

### Features

- Added a control to delete lost file records that are no longer on the network or device.
- Added a control to export the app database for debugging.
- Added a metadata migration system for safely upgrading object metadata when the schema changes.
- Added a control to reset the sync up cursor, allowing metadata to be re-pushed for all files.
- Added sync metadata status display showing remote down and local up progress.

### Fixes

- Improved sync performance with batched database writes and adaptive polling intervals.
- Fixed app reset to fully stop background services and return to onboarding.
- Fixed thumbnails failing to generate for files with identical content hashes.
- Improved responsiveness of library updates by refining how cached data is refreshed.
- Changed log sharing to use the native share sheet instead of copying to clipboard.
- Replaced the upload icon with a spinner that shows during upload or sync activity.
- Added a syncing indicator on the empty library screen so new users can see progress.

## 1.5.1 (2026-02-14)

### Fixes

- Added error boundary and global error logging to catch and log unexpected crashes.
- Fixed a bug on Android where downloaded files would loop back to downloading.
- Fixed Android crash caused by missing Google Maps API key in CI release builds.
- Fixed copy and export logs not including all log entries.

## 1.5.0 (2026-02-13)

### Features

- Redesigned library status sheet with organized sections, count/size toggle, and aligned monospace formatting.
- Upload progress is now weighted by file size instead of equal per-file weighting.
- Structured logging with machine-readable JSONL export.

### Fixes

- Resume fetching archive photos when pending upload data drops below 4 slabs instead of waiting for 0 files.
- Fixed upload batch duration tracking to use AppState signal instead of inferring iOS suspension from gaps between adds.
- Fixed upload percentage exceeding 100% due to double-counting completed files.
- Refined log viewer with faster scopes query, limited log fetch to 500 entries, and improved new log detection.
- Switched upload stats and log scopes sheets to native page sheet modals.
- Improved upload parallelism and added proper cancellation for inflight uploads.

## 1.4.0 (2026-02-10)

### Features

- Added periodic CPU and memory usage logging for performance monitoring.
- Redesigned upload system to replace the separate scanner with direct DB polling and slab-aware batch packing.

### Fixes

- Fixed file sharing not working on Android.
- Fixed file viewer flickering and showing wrong file during sync by using a frozen ID window for carousel positions.
- Fixed crash in file details view caused by rendering a number outside a Text component.
- Fixed image reloading when switching between viewer and detail view.
- Fixed file detail view not scrollable on Android by using gesture-handler-aware ScrollView.
- Local storage stats now auto-refresh while the status sheet is open.
- Fixed orphan and eviction scanners blocking the UI by running them during startup and background tasks only, with batched processing for the orphan scanner.
- Fix file viewer flickering when library updates.
- Archive sync now waits for all files to finish uploading before continuing.
- Improved drag-to-dismiss gesture to feel more responsive with velocity-based flick detection and a lower distance threshold.
- Logs emitted before the database is ready are now queued and flushed once the logger initializes.
- Cancel uploads now actually aborts in-flight batches instead of only clearing UI state.

## 1.3.0 (2026-02-05)

### Features

- Added a floating "New logs" button with auto-follow mode to the logs screen.

### Fixes

- Fixed keychain migration to delete items before re-adding with new accessibility permissions, enabling background task access when device is locked.
- Improved packed uploader cleanup when SDK is reset.
- Removed pointless retries from SecureStore that cannot help when keychain is inaccessible.

## 1.2.0 (2026-02-04)

### Features

- Added copy to clipboard action and adaptive overflow menu to logs screen.

### Fixes

- Upgraded the SDK to fix a bug in upload packing that could corrupt objects in certain situations.
- iOS builds now use iOS 26 SDK to meet Apple's April 2026 App Store requirement.

## 1.1.0 (2026-02-03)

### Features

- E2E tests now use dedicated simulators to avoid affecting developer devices.
- Added local E2E testing infrastructure with Maestro support. Run `bun run e2e:ios` or `bun run e2e:android` to execute tests locally.
- Files are now packed into 40 MiB slabs for more efficient uploads.

### Fixes

- Improved performance for quick interactions, bulk uploads, and progress updates.
- The FileCarousel can now be dismissed with a down swipe.
- The carousel now updates automatically when files are added, removed, or renamed.
- Background tasks now wait for app initialization on iOS cold starts.
- Improved background task logging with invocation IDs and data sizes.
- Improved logging for debugging background task behavior including app state transitions, cold start detection, and keychain access diagnostics.
- Added support for selecting multiple files to download, upload, or delete at once.
- Improved performance and smoothness when swiping through files in the carousel.
- Added educational articles to menu explaining how Sia storage works.
- Fixed background uploads failing when the device is locked by using AFTER_FIRST_UNLOCK keychain accessibility.
- Fixed background tasks freezing when iOS fires timeout callback.
- Fixed an issue where deleting a file would show "failed to delete" even though the file was deleted.
- Fixed an issue where the logger was writing to the database before it was initialized.
- Added error cooldown and magic byte detection for thumbnail generation.
