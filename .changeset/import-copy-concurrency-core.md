---
core: minor
---

The import scanner schedules copies through a byte-weighted concurrency pool, paced by pending unuploaded bytes; the backlog counts only files whose bytes are still on the device, so an unuploadable lost file can never stall pacing.
