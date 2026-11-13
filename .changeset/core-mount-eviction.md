---
core: minor
---

On a library with a mount, the eviction pass counts the mount's bytes against the cache limit and frees the least recently used copy from either place, asking the system to remove a mount copy through the host adapter's new `dehydrate`. `provider.touch` records that a file was opened in the mount, `cache.startClear` and `cache.clearState` start a clear without waiting and follow it, and every provider anchor and file metadata version carries an item format, so an integration lists the library again once.
