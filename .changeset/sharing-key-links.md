---
core: minor
---

Adds share links built on sharing keys: `app.shares.createLink`, `links`, `addLinkFiles`, `removeLinkFiles` and `revokeLink`, with `syncLinks` and the `runShareLinkSync` service keeping a `latest` link on its files' current versions while a `snapshot` link keeps the versions it was made with. `SdkAdapter` gains the sharing-key methods, and its per-object share URL methods are renamed `objectShareUrl` and `objectFromShareUrl`.
