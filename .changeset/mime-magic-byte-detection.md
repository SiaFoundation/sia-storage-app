---
core: patch
---

Detect AVI, MKV, FLAC, OGG, AIFF, 7z, bzip2, xz, RAR, ZIP, and gzip from magic bytes so files with missing or wrong extensions still resolve to the correct MIME instead of `application/octet-stream`.
