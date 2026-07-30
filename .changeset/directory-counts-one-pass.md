---
core: patch
---

Optimize the directory listing queries: file and subdirectory counts now come from one pass instead of a correlated subquery per row. Child matching is now case-sensitive.
