---
default: patch
---

Logs emitted before the database is ready are now queued and flushed once the logger initializes.
