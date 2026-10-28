---
core: patch
mobile: patch
---

Cache eviction and Clear local files finish when some files cannot be deleted, instead of retrying the same files until they are stopped. `fs.evictionCandidates`, `fs.nonCurrentCachedFiles` and `fs.trashedCachedFiles` take a cursor and return each row's `usedAt`.
