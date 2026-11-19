---
desktop: patch
platforms: macos
---

A file saved again within 30 seconds in the Finder folder waits to upload until the saves stop for 30 seconds, or for at most 2 minutes, so an app that saves every few seconds uploads a few versions instead of hundreds. A file's first save, a save after a longer pause and a newly added file upload at once as before, and sharing a waiting file uploads it at once.
