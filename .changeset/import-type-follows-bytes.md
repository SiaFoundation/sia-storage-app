---
core: patch
mobile: patch
---

A file whose content is not the format its filename claims now imports and uploads normally instead of landing under Unavailable files. An edited raw photo is stored as the rendered JPEG it actually is, and named to match. `nameForType` in `@siastorage/core/lib/fileTypes` gives a name the extension its type implies.
