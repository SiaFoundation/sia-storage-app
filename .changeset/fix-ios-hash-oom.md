---
mobile: patch
---

Fixed iOS out-of-memory crashes when hashing large files by patching react-native-fs to stream in 64KB chunks instead of loading the entire file into memory.
