---
cli: patch
---

`sia daemon start` with no network keeps trying to reach the indexer and connects once it can, instead of staying disconnected until the daemon is restarted. Closes https://github.com/SiaFoundation/sia-storage-app/issues/1128
