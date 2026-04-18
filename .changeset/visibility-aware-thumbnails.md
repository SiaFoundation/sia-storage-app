---
core: minor
---

SlotPool.acquire() accepts { priority, maxQueueDepth } options. Lower priority numbers are served first; same-priority waiters are LIFO; when maxQueueDepth is set, inserting past that many same-priority waiters evicts the oldest with AbortError.
