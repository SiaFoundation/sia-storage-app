---
core: minor
---

The library keeps a local apply-order record of every file and folder change, including which folder each moved or deleted item left. `directories.ensureAtPaths` and upsertMany's `directoryIdByFileId` option let bulk writers create files directly in their folders.
