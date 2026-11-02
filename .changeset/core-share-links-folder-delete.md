---
core: patch
---

Trashing a file takes it off every share link for good, share link files no longer have a `trashed` state, and `directories.delete` throws for a folder that still holds files.
