# Changelog

All notable changes to Sia Storage will be documented in this file.
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
