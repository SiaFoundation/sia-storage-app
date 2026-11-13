---
core: minor
---

A library can be shown in a mount, a folder a file manager keeps its own copies in (`settings.setMount`, with a host `mount` adapter that lists the files the system holds). The new `mount_copies` table records which version of each file the mount holds, kept by `provider.fetch`, `fetchRange`, `create`, `write`, `rename` and `trash` and corrected from the adapter's list on each eviction pass. An item's `downloaded` is also true for a file the mount holds whole, and `cache.bytesOnDevice` counts both places.
