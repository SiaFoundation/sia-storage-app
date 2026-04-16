---
core: minor
---

Add empty directory cleanup operation with cascading parent deletion and sync-down integration. `queryDirectoryChildren` and `queryAllDirectoriesWithCounts` now report `fileCount` recursively (this directory plus all descendants), so a parent that holds files only in subdirectories shows the total instead of zero.
