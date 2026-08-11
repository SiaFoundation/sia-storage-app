---
core: patch
---

deleteLostFilesAndThumbnails only deletes files with no object on any indexer, so a file still hosted on another indexer survives one indexer's lost-file cleanup.
