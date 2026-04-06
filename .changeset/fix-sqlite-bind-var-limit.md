---
core: patch
---

Add operation-level batching for unbounded SQL queries (auto-purge, delete lost files, delete directory) to keep memory bounded and yield to the event loop between batches.
