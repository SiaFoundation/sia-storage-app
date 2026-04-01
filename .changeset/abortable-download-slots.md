---
core: minor
---

SlotPool.acquire() and SlotPool.withSlot() accept an optional AbortSignal so cancelled waiters release their queue position immediately. downloads.downloadFile() now registers the entry synchronously before the first DB read so cancel() arriving during initial metadata lookup is honored.
