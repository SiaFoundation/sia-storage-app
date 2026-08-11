---
core: patch
---

updateFile now recalculates version currency when the auto-bumped updatedAt makes a row its group's newest, not only when the caller supplies updatedAt.
