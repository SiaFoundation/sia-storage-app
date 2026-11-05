---
core: patch
---

`createAppService` takes `usedAtUpdateIntervalMs`, how often at most a read records a file as used, once an hour when left out. The CLI and desktop daemon pass 5 minutes, so their eviction pass sees a file read again within the hour as recently used.
