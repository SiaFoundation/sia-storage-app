---
mobile: patch
core: patch
---

The app deletes copies of files its library has no record of, such as those an earlier version left behind after clearing local data, once a day while it is open, and Clear local files reports the space it actually freed and finishes much sooner on a large library. `fs.liveFileTypes` looks each id up by primary key, so its time no longer grows with the size of the library. `runOrphanScanner` takes `spareWrittenWithin`, reports `bytesFreed` and skips files being written, `fs.findOrphanedFileIds` takes `writtenSince`, `fs.filesBeingWritten()` lists the ids `writeFileData`, `adoptFile` and `copyFile` are writing, and `fs.removeFileByPath` returns the bytes it removed.
