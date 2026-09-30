---
core: minor
---

Adds `repairRawPhotoTypes` in `@siastorage/core/services/repairRawPhotoTypes` and `files.getRawPhotosStoredAsTiff()`, and `syncDownEventsBatch` runs the repair once per app instance after its first pass that reaches the end of the event stream. The repair keeps each file's `updatedAt`.
