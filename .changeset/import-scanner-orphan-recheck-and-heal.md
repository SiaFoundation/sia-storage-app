---
core: patch
---

Import scanner re-checks the fs row before marking a placeholder lost, and clears any stale "lost" reason when a file is successfully hashed.
