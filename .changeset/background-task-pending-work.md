---
mobile: patch
core: patch
---

While the phone is charging, the app's background run clears space from cached copies first, then keeps going until imports, the photo library walk, library sync and metadata changes are done, and checks for library changes at least once, instead of stopping as soon as nothing is waiting to upload. Background runs also remove stranded local copies once a day, and stop early when the app cannot reach the network or nothing is moving, instead of holding the phone awake. `imports.activeCopies()` reports the import files being copied and the bytes copied so far, and the sync state counts finished sync-down runs in `syncDownRuns`.
