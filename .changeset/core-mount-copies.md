---
core: minor
---

A library can be shown in a mount, a folder a file manager keeps its own copies in (`settings.setMount`). The new `mount_copies` table records which version of each file the mount holds, kept by `provider.fetch`, `fetchRange`, `create`, `write`, `rename` and `trash`, and `provider.touch` records that a file was opened there. An item's `downloaded` is also true for a file the mount holds whole, and `cache.bytesOnDevice` counts both places.
