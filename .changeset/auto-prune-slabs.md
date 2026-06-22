---
'@siastorage/mobile': patch
'@siastorage/core': patch
'@siastorage/cli': patch
---

Periodically reclaim account storage left behind by deleted files. A background task calls the indexer's prune endpoint about once a day (and on app start/foreground, throttled).
