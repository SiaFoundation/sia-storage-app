---
core: minor
---

`settings.getCacheMinAge` and `setCacheMinAge` store how long an uploaded file is kept after its last use, `cache.evict` runs one eviction pass with it, and a call during a running pass gets that pass's result.
