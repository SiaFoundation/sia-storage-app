---
default: minor
---

Fixed photo sync missing photos without EXIF creation timestamps by switching to modificationTime sorting, and added periodic background re-scans to catch cross-device synced photos arriving with old timestamps.
