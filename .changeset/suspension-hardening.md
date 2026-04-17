---
core: patch
---

Extend the suspension manager with phase 4/5 timing and a time-boxed db.close(), add UploadManager.getDiagnostics() and SuspensionAdapters.uploader.getDiagnostics for suspend-time snapshots, and make AppService.optimize() also run wal_checkpoint(PASSIVE) and return { walFrames, checkpointed, busy }.
