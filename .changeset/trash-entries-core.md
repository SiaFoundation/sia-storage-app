---
core: patch
---

`files.trashEntries`, `trashCount`, `restoreTrashEntries`, `deleteTrashEntries` and `emptyTrash` list the trash one file at a time, with the versions trashed with it, and act on it. Trashing and restoring keep a file's versions in order, and a file restored to a name a live file has taken since comes back as `name (restored).ext`.
