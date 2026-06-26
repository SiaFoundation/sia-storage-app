## 0.0.5 (2026-06-26)

### Fixes

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
