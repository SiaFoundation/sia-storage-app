---
core: minor
desktop: patch
mobile: patch
---

The status says "Waiting to upload" while files on the device have not uploaded yet, instead of "Up to date" on desktop and "Importing" on mobile. `@siastorage/core/lib/uploadActivity` adds `summarizeUploads` and `filesWaitingToUpload` for building that status.
