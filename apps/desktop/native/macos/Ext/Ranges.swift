// Turning the system's requested extent into one the daemon can serve.
//
// The system asks for a minimal range and an alignment, and accepts any
// properly aligned range that covers it. Alignment is a power of two the
// system chooses per request and does not keep stable across reboots, so it
// is never cached.

import Foundation

/// How far past the requested range to read. A read waits on the whole
/// window, so this trades a seek's first-byte delay against how far ahead of
/// a player the fetch stays.
let readAheadBytes = 8 << 20

/// What to fetch to cover the range the system asked for.
///
/// A round trip's setup does not shrink with the bytes it carries, so
/// serving the minimum alone costs one per few tens of kilobytes and a
/// player reading forward starves. Only the end widens, because widening
/// backward would delay the bytes the reader waits on.
func fetchWindow(_ requested: NSRange, alignment: Int, documentSize: Int64) -> NSRange {
    let widened = NSRange(
        location: requested.location, length: max(requested.length, readAheadBytes))
    return alignedRange(widened, alignment: alignment, documentSize: documentSize)
}

/// Widens `requested` outward to `alignment`, then clamps the end to
/// `documentSize`.
///
/// The clamp is there because the last range of a file is shorter than the
/// alignment. Rounding its end up would run past the end of the file, and
/// the system validates the end it gets back against the document size the
/// item reported.
func alignedRange(_ requested: NSRange, alignment: Int, documentSize: Int64) -> NSRange {
    let size = max(0, documentSize)
    let start = Int64(requested.location)
    let end = start + Int64(requested.length)
    // The request starts at or past the end of the file, so there is nothing
    // to serve. Rounding its start down would return bytes the system did not
    // ask for and still not cover the request.
    guard start < size, end > 0 else {
        return NSRange(location: Int(min(max(0, start), size)), length: 0)
    }

    let from = max(0, start)
    let to = min(end, size)
    guard alignment > 1 else {
        return NSRange(location: Int(from), length: Int(to - from))
    }

    let step = Int64(alignment)
    let alignedFrom = from - (from % step)
    let alignedTo = min(to % step == 0 ? to : to + (step - to % step), size)
    return NSRange(location: Int(alignedFrom), length: Int(max(0, alignedTo - alignedFrom)))
}
