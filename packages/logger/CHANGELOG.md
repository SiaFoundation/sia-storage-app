## 0.0.3 (2026-04-29)

### Features

- Added optional log forwarding under Settings → Advanced — every log entry is sent as NDJSON to a user-supplied HTTP endpoint with optional Bearer auth, and resumes from a saved cursor after offline gaps.

## 0.0.2 (2026-04-06)

### Features

- Buffer log entries in memory and flush to the database every 2 seconds in a single transaction.
