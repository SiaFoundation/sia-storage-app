---
core: minor
---

Replace the sync-up watermark cursor with a per-object needsSyncUp dirty flag. Sync-up now pushes only changed objects, fixing both the redundant re-pushes after a large sync-down and the race where an edit could slip past the advancing cursor and never sync.
