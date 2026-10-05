---
core: minor
---

Adds `auth.builder.reconnecting` and `auth.builder.matchesExistingAppKey`, which say after approval whether the approving account already uses the app and whether a recovery phrase is one of its own. Both return null where the platform's SDK cannot say.
