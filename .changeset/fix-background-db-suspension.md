---
mobile: patch
---

Fixed background crashes (iOS 0xdead10cc) caused by SQLite file locks held during app suspension. The database now gates queries, drains in-flight operations, and checkpoints the WAL before closing.
