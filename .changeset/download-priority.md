---
core: minor
---

`downloads.downloadFile` takes a priority, `'user'` or `'background'`, and a `'user'` call for a file queued as `'background'` raises it so the queue can no longer drop it. `downloads.wasDropped(id)` reports whether the background queue dropped a file's last download. The exported `MAX_AUTO_DOWNLOAD_QUEUE` is renamed `MAX_BACKGROUND_DOWNLOADS_QUEUED`.
