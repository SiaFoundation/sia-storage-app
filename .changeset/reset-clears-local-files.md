---
mobile: patch
cli: patch
core: patch
---

Clearing local data, signing out and `sia reset` delete the device's copies of the library they drop. Before, those copies stayed on the device and no cleanup could find them again. `sia reset` stops without deleting anything when the daemon does not shut down. `downloads.cancelAll()` resolves once every cancelled download has settled.
