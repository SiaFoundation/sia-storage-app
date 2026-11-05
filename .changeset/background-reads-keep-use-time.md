---
core: patch
mobile: patch
---

Photos that finish uploading during an import are removed by the regular cache cleanup instead of staying on the device for a day, once their thumbnails are made. `fs.getFileUri` takes `{ recordUse: false }` for reads that should not count as a use, and `fs.evictionCandidates` takes the thumbnail types to wait for.
