---
mobile: patch
core: patch
---

The library grid, its counts and the photo viewer load faster in large libraries, for every sort order. `buildLibraryQueryParts` returns `indexedBy` clauses for reads over the whole library, and the name sort no longer moves files without a `nameSortKey` to the end.
