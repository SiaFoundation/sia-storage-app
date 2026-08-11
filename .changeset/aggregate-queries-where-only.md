---
core: patch
---

queryFileCount and queryFileStats apply only the WHERE filters; a caller limit of 0 previously made them return zero counts.
