---
core: patch
---

Tag changes, favorites and folder renames and moves stamp each changed file without reordering the versions of any file, and restamp a newer version only when an older one has no room left below it, so an older version no longer becomes the file the library shows and an edit another device made to the newer version is kept. `files.renameFile` refreshes the cached row of every version it renames.
