---
core: minor
---

Add `queryTrashedCachedFiles` and `queryNonCurrentCachedFiles` DB ops, the matching `app.fs.trashedCachedFiles` and `app.fs.nonCurrentCachedFiles` facade methods, and the `FS_EVICTABLE_MIN_AGE_NON_CURRENT` config to back the new eviction pre-passes.
