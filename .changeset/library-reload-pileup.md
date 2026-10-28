---
mobile: patch
core: patch
---

While uploads or sync keep changing the library, the grid's loading spinner clears once the next page arrives, where it could stay stuck until the app restarted. `useFileList` returns `isLoadingMore` and `useLoadMore` takes it in place of `data` and `isValidating`, and list reloads and `invalidateAll()` refreshes each run one at a time, with one more after for changes made meanwhile.
