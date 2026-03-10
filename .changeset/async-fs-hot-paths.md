---
mobile: patch
---

Replaced synchronous Expo FS calls with async RNFS APIs in hot-path file operations to reduce JS thread blocking.
