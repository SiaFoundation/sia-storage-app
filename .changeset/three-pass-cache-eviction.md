---
core: minor
---

Cache eviction now runs three passes: trashed files that have already been backed up are evicted immediately, superseded file versions past `FS_EVICTABLE_MIN_AGE_NON_CURRENT` (default 1 hour), then LRU only while the cache is over `FS_MAX_BYTES`. Thumbnails of current files are never evicted, and local-only files (no indexer object) are never evicted in any pass.
