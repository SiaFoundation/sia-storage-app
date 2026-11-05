---
core: patch
mobile: patch
---

Photos that finish uploading during an import are removed by the regular cache cleanup instead of staying on the device for a day, once their thumbnails are made, and scrolling past photos in the library no longer keeps their copies on the phone. Only opening, sharing or saving a file counts as using it. `fs.getFileUri` counts a read as a use only when passed `{ recordUse: true }`, and `fs.evictionCandidates` takes the thumbnail types to wait for.
