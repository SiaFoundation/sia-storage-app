---
core: minor
---

A trashed file leaves its folder and remembers the folder's path, which restore recreates, and a folder emptied by trashing or deleting its last file is removed, as sync-down already does on other devices. `files.trashFile` takes `keepFolder` and `directories.deleteAndTrashFiles` takes `keepParent` to leave that folder in place. `TrashEntry` gains `kind` and `files`, with a deleted folder listed as one `folder` entry, its `folder` is now the path the entry restores into, and `FileMetadata` gains `trashedFolder`. `restoredText` takes the entry's kind, `directories.deleteAndTrashFiles` runs in one transaction, and `renameFile`, `moveFile`, `trashFile` and `tombstoneFile` given a trashed file's id do nothing.
