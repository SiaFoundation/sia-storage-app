---
core: minor
---

Added downloads.downloadFromShareUrl(id, url) and removed register, update, remove, acquireSlot, releaseSlot from the public downloads API — the share-URL flow now runs entirely inside the downloads namespace with the same cancel() / cancelAll() semantics and abortable slot-queue waits as downloadFile().
