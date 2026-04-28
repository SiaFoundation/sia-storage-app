---
core: patch
---

Sync-down now applies all of each batch's database writes (files, objects, directories, tags, current-version) in a single transaction, so a mid-batch failure rolls back cleanly and the same batch retries on the next sync cycle. Filesystem cleanup and cache invalidations still run after the transaction commits.
