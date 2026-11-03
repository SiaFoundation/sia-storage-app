---
core: minor
---

`app.provider.thumbnail` returns a file's 512px thumbnail for a File Provider host, and a cloud-only file's `modifiedAt` reads one second later once its 512px thumbnail is on the device, which is what makes Finder ask again for a thumbnail it failed to get.
