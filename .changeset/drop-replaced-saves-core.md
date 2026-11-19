---
core: minor
---

A file saved again and again in the Finder folder while offline or behind on uploads uploads only its newest save, instead of every save in turn. A save that a share link names, or that has started uploading, still uploads. `app.uploader.withdraw` takes a file off the upload queue unless a batch holds it and says which, `app.files.deleteIfUnsentOlderVersion` deletes an older version that never left this device, and `app.thumbnails.createForLiveFile` records a thumbnail only while its file is live.
