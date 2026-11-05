---
core: minor
desktop: patch
mobile: patch
---

The status says when the account's storage is full and how many files are waiting on it, and how many files could not upload while they wait to be tried again. A file saved while the account is full waits for room instead of failing. `app.uploads.getState()` reports `storageFull`, and `files.query` takes `ids` to limit a query to those rows.
