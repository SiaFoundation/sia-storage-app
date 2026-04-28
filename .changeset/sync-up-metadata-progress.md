---
core: patch
---

Sync-up metadata progress now accumulates across batches instead of being overwritten by the current batch size on each tick, so the status sheet counts up smoothly toward the total instead of stalling at the batch size.
