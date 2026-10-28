---
core: patch
desktop: patch
cli: patch
---

Opening a file from Finder no longer fails when the cache removes its copy at the same moment, and a download is never cut short by cache cleanup. `fs.removeFile` takes `skipIfLocked` and resolves whether it removed the file.
