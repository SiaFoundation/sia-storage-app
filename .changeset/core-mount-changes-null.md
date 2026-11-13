---
core: patch
---

`MountAdapter.changes` may resolve `null` while the integration it reads from is not connected, and the mount service then leaves its record of downloaded files as it is.
