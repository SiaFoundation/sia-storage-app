---
default: patch
---

Fixed orphan and eviction scanners blocking the UI by running them during startup and background tasks only, with batched processing for the orphan scanner.
