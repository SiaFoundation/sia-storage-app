## 0.0.7-rc.3 (2026-10-26)

### Fixes

- The background service frees the disk space held by older versions of a file and by trashed files once they are backed up.
- A release candidate keeps its library in `~/.sia-beta`, apart from the one a release uses, so the first candidate you run starts signed out.
- Commands that change the library, such as trashing or renaming a file, no longer fail while the library is syncing.
- Adds `sia share`, `sia unshare`, `sia revoke` and `sia links` to make, change, revoke and list share links, the same links the phone and desktop app make.
- BMP images get thumbnails, and on Linux the background service no longer tries and fails to thumbnail TIFF, HEIC and AVIF images.
- `sia --version` reports the released version rather than the release candidate it was built from.
- `sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.
- Files no longer upload with another file's contents when other files in the same upload could not be read.
- A file whose name contains `#` or `?` gets the type its extension names instead of a generic one.
- Opening many cloud-only files at once in Finder, or running many `sia download` commands at once, no longer fails some of them.
- Canon raw (CR3) photos are recognized from their contents, and a file Android reports with no type (`application/octet-stream`) takes its type from its name or contents instead.
- Files with an extension such as `.constructor` or `.__proto__` are stored with an unknown file type instead of a bogus one.
- A name with accents or other combined characters is stored the same way whichever app it came from, so a file saved in Finder and the same file added on a phone share one name and one version history. Names already stored are converted on the first launch after the update.
- Camera raw photos such as DNG, CR2, NEF and ARW keep their raw type on every device instead of being stored or renamed as TIFF.
- Raw photos stored as TIFF, such as DNGs an iPhone relabelled, get their raw type back the next time the app starts and catches up with the network.
- Moving a file out of a folder to the top level, or removing its last tag, now shows up on your other devices.
- Small downloads, such as the photos in a folder you open, start right away instead of waiting for large downloads to finish. Eight downloads run at once by default, up from two, including on phones that had saved the old default, and `SlotPool` can limit the total weight of what runs as well as the count.
- When another device changes a file's type, the copy already on this device moves to match, so the file opens from disk instead of downloading again.
- Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
- `sia trash` lists the trash, `sia restore` puts files back with their versions, under a new name such as `notes (restored).txt` when a file has taken theirs, and `sia trash --delete` and `sia trash --empty` delete them for good.
- Taking a file out of Favorites on one device now takes it out on your other devices too.
- A file added while the app is checking for new uploads no longer uploads twice.
- Upload progress no longer counts files that can never upload, so it reaches complete once everything else has uploaded. `UploadCategoryStats.total` covers uploaded and remaining files only, and the new `unavailable` and `unavailableBytes` count files with no object on the indexer and no local copy, or marked lost. The phone's status sheet and `sia status` show those files separately.
- Portrait iPhone photos and other rotated HEIC and TIFF images get upright previews when added from the desktop app or the CLI, instead of previews turned on their side.

## 0.0.7-rc.2 (2026-10-13)

### Fixes

- The background service frees the disk space held by older versions of a file and by trashed files once they are backed up.
- A release candidate keeps its library in `~/.sia-beta`, apart from the one a release uses, so the first candidate you run starts signed out.
- Commands that change the library, such as trashing or renaming a file, no longer fail while the library is syncing.
- BMP images get thumbnails, and on Linux the background service no longer tries and fails to thumbnail TIFF, HEIC and AVIF images.
- `sia --version` reports the released version rather than the release candidate it was built from.
- `sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.
- Files no longer upload with another file's contents when other files in the same upload could not be read.
- A file whose name contains `#` or `?` gets the type its extension names instead of a generic one.
- Opening many cloud-only files at once in Finder, or running many `sia download` commands at once, no longer fails some of them.
- Canon raw (CR3) photos are recognized from their contents, and a file Android reports with no type (`application/octet-stream`) takes its type from its name or contents instead.
- Files with an extension such as `.constructor` or `.__proto__` are stored with an unknown file type instead of a bogus one.
- A name with accents or other combined characters is stored the same way whichever app it came from, so a file saved in Finder and the same file added on a phone share one name and one version history. Names already stored are converted on the first launch after the update.
- Camera raw photos such as DNG, CR2, NEF and ARW keep their raw type on every device instead of being stored or renamed as TIFF.
- Raw photos stored as TIFF, such as DNGs an iPhone relabelled, get their raw type back the next time the app starts and catches up with the network.
- Moving a file out of a folder to the top level, or removing its last tag, now shows up on your other devices.
- When another device changes a file's type, the copy already on this device moves to match, so the file opens from disk instead of downloading again.
- Taking a file out of Favorites on one device now takes it out on your other devices too.
- A file added while the app is checking for new uploads no longer uploads twice.

## 0.0.7-rc.1 (2026-10-13)

### Fixes

- The background service frees the disk space held by older versions of a file and by trashed files once they are backed up.
- A release candidate keeps its library in `~/.sia-beta`, apart from the one a release uses, so the first candidate you run starts signed out.
- Commands that change the library, such as trashing or renaming a file, no longer fail while the library is syncing.
- BMP images get thumbnails, and on Linux the background service no longer tries and fails to thumbnail TIFF, HEIC and AVIF images.
- `sia --version` reports the released version rather than the release candidate it was built from.
- `sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.
- Files no longer upload with another file's contents when other files in the same upload could not be read.
- A file whose name contains `#` or `?` gets the type its extension names instead of a generic one.
- Opening many cloud-only files at once in Finder, or running many `sia download` commands at once, no longer fails some of them.
- Canon raw (CR3) photos are recognized from their contents, and a file Android reports with no type (`application/octet-stream`) takes its type from its name or contents instead.
- Files with an extension such as `.constructor` or `.__proto__` are stored with an unknown file type instead of a bogus one.
- A name with accents or other combined characters is stored the same way whichever app it came from, so a file saved in Finder and the same file added on a phone share one name and one version history. Names already stored are converted on the first launch after the update.
- Camera raw photos such as DNG, CR2, NEF and ARW keep their raw type on every device instead of being stored or renamed as TIFF.
- Raw photos stored as TIFF, such as DNGs an iPhone relabelled, get their raw type back the next time the app starts and catches up with the network.
- Moving a file out of a folder to the top level, or removing its last tag, now shows up on your other devices.
- When another device changes a file's type, the copy already on this device moves to match, so the file opens from disk instead of downloading again.
- Taking a file out of Favorites on one device now takes it out on your other devices too.
- A file added while the app is checking for new uploads no longer uploads twice.

## 0.0.7-rc.0 (2026-09-29)

### Fixes

- The background service frees the disk space held by older versions of a file and by trashed files once they are backed up.
- A release candidate keeps its library in `~/.sia-beta`, apart from the one a release uses, so the first candidate you run starts signed out.
- Commands that change the library, such as trashing or renaming a file, no longer fail while the library is syncing.
- `sia --version` reports the released version rather than the release candidate it was built from.
- `sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.

## 0.0.6 (2026-08-27)

### Features

- `sia daemon start` can serve a second, narrowed socket for an OS storage-provider shell, so a desktop app can put the library in Finder without exposing the whole daemon surface to it.

### Fixes

- A second daemon can no longer start against the same data directory.

## 0.0.6-rc.0 (2026-08-25)

### Features

- `sia daemon start` can serve a second, narrowed socket for an OS storage-provider shell, so a desktop app can put the library in Finder without exposing the whole daemon surface to it.

### Fixes

- A second daemon can no longer start against the same data directory.

## 0.0.5 (2026-06-26)

### Fixes

- Periodically reclaim account storage left behind by deleted files. A background task calls the indexer's prune endpoint about once a day (and on app start/foreground, throttled).
- Moving or permanently deleting a file now affects its entire version history, not just the current version, so older versions no longer get left behind in the original folder.

## 0.0.4 (2026-05-21)

### Fixes

- Add download command for retrieving files to disk. Defaults to the current directory using the file's original name; pass `--output <path>` to choose a destination.
- Logging dispatches each entry to a registry of appenders. Available sinks: a console appender (logger pkg), a Node file appender (node-adapters), and a SQLite appender (`DbLogAppender` in core). Remote log shipping is a separate service that reads from the `logs` table — its toggle does not affect local persistence. Appenders support `pause` / `resume` for iOS suspension and a synchronous pre-suspend RAM flush.

## 0.0.3 (2026-05-13)

### Features

- The compiled CLI binary now generates image thumbnails (Bun.Image). Sharp moves to a `./thumbnail-sharp` subpath of `@siastorage/node-adapters` for Node consumers.

## 0.0.2 (2026-05-08)

### Features

- Add connect command with interactive indexer connection, browser-based approval, and recovery phrase setup.
- Add ls, mkdir, rm, mv, add, download, import, info, and reset commands.
- Add query and configuration commands with shell completion generation.
- Add CLI application with daemon-based architecture, background service scheduling, and core utility libraries.
