# Changelog

All notable changes to Sia Storage will be documented in this file.
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
