## 0.0.5 (2026-05-21)

### Features

- Logging dispatches each entry to a registry of appenders. Available sinks: a console appender (logger pkg), a Node file appender (node-adapters), and a SQLite appender (`DbLogAppender` in core). Remote log shipping is a separate service that reads from the `logs` table — its toggle does not affect local persistence. Appenders support `pause` / `resume` for iOS suspension and a synchronous pre-suspend RAM flush.

## 0.0.4 (2026-05-02)

### Fixes

- Made the log appender's stop non-blocking and moved scheduler pause/abort before suspend pre-work, so iOS suspension no longer stalls on a DB flush behind still-ticking services.

## 0.0.3 (2026-04-29)

### Features

- Added optional log forwarding under Settings → Advanced — every log entry is sent as NDJSON to a user-supplied HTTP endpoint with optional Bearer auth, and resumes from a saved cursor after offline gaps.

## 0.0.2 (2026-04-06)

### Features

- Buffer log entries in memory and flush to the database every 2 seconds in a single transaction.
