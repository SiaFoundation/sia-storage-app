---
mobile: patch
core: patch
---

Made iOS foreground/background event handling more deterministic by centralizing AppState reading and emitting transitions in a single fixed order.
