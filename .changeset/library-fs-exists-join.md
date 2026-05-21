---
core: patch
mobile: patch
---

`queryLibrary` now returns an `fsExists` flag per row via LEFT JOIN, and the file-list fetcher primes the per-fileId fs URI cache. List-row `useFsFileUri` hooks no longer fan out into one SELECT + `RNFS.stat` per visible row.
