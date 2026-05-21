---
mobile: patch
---

Picker imports no longer race the scanner's orphan branch during the initial INSERT, preventing files that copied successfully from being marked with a stale "lost" reason.
