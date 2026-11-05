---
core: patch
---

Cache eviction holds a backed-up file for an hour after its last use by default instead of a day, and a read records a file as used at most every 5 minutes instead of every hour. `createAppService` takes `cacheMinAgeMs` and `usedAtUpdateIntervalMs` to set both.
