---
core: minor
---

`thumbnails.read(fileId, size)` returns one version's thumbnail as base64 image data, downloading it if only another device has it, or null when no thumbnail of that size has synced or the file is trashed or deleted.
