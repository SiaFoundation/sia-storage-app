---
core: patch
mobile: patch
---

Fixed picker imports occasionally getting permanently marked as "File unavailable" right after a successful import. The import scanner could race the background copy and mark just-inserted placeholders lost before their bytes had landed.
