---
core: minor
---

The provider surface lists the whole library on one cursor, folders before files, and answers "what changed since this anchor" for one folder or everything. A moved item arrives as an update carrying its new parent, deletions and folder renames as ordinary deltas, and an anchor stays answerable for as long as a client keeps polling.
