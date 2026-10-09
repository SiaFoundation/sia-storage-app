## 0.0.7-rc.1 (2026-10-09)

### Fixes

- The background service frees the disk space held by older versions of a file and by trashed files once they are backed up.
- A release candidate keeps its library in `~/.sia-beta`, apart from the one a release uses, so the first candidate you run starts signed out.
- Commands that change the library, such as trashing or renaming a file, no longer fail while the library is syncing.
- BMP images get thumbnails, and on Linux the background service no longer tries and fails to thumbnail TIFF, HEIC and AVIF images.
- `sia --version` reports the released version rather than the release candidate it was built from.
- `sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.
- Moving a file out of a folder to the top level, or removing its last tag, now shows up on your other devices.
- When another device changes a file's type, the copy already on this device moves to match, so the file opens from disk instead of downloading again.
- Taking a file out of Favorites on one device now takes it out on your other devices too.

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
