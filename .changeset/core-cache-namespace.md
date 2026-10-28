---
core: minor
---

`settings.getCacheMaxBytes`, `setCacheMaxBytes`, `getCacheMinAge` and `setCacheMinAge` store the cache limit and minimum age, `cache.evict` runs one eviction pass with them, and a call during a running pass gets that pass's result.
