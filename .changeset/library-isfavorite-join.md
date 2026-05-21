---
core: patch
---

`queryLibrary` now returns an `isFavorite` flag per row via LEFT JOIN, and the file-list fetcher primes the per-fileId favorites cache. List-row `useIsFavorite` hooks no longer fan out into one `SELECT FROM file_tags` per visible row.
