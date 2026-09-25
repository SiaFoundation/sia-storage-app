---
core: minor
---

`app.provider.write` adds the new bytes as the file's newest version, and a provider item keeps the same id across all of a file's versions. Adds `files.addVersion`, and `files.update` and `files.updateMany` no longer accept `hash`, so a file's bytes change only through a new version.
