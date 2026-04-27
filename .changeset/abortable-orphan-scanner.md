---
core: minor
---

`runOrphanScanner` now accepts an `AbortSignal` and checks it between batches and between rows, so iOS suspension can drain the loop cleanly before the DB gate closes.
