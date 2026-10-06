---
core: patch
mobile: patch
---

An import copy that ends as cancelled outside a suspension is retried at once the first time and backs off if it happens again, instead of leaving it and the files after it waiting ten minutes.
