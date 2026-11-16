---
core: minor
---

On a library with a mount, the cache copy of a file is removed once the file is on the current indexer and the mount holds it whole: when the system reports the file, after an upload is saved, after thumbnails are made and at the start of each eviction pass. The host's `mount` adapter gains `resend`, which asks the system to hand a file's bytes back, and `provider.write` keeps bytes that match the current version as its cache copy when it has none and is not on the current indexer, so a file only the mount holds can upload again after the indexer is changed.
