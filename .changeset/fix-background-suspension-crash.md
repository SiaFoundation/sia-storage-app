---
mobile: patch
---

Fixed iOS killing the app when backgrounded by closing the database connection before suspension to release SQLite WAL file locks.
