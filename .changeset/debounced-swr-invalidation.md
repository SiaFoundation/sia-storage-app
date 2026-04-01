---
core: minor
mobile: patch
---

Add debounced cache invalidation API to SWR cache helpers. Batch upload operations now use single bulk invalidation instead of per-item cascades.
