---
core: patch
---

`UploadManager` stops or parks right away when `shutdown()` or `suspend()` is called during a database poll, instead of sleeping a full poll interval first and, when suspended with a batch open, flushing that batch.
