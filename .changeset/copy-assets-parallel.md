---
mobile: patch
---

Picker imports copy files in parallel (up to 4 at a time, bounded by total bytes in flight) instead of one at a time. Cloud sources like Google Drive in particular finish significantly faster.
