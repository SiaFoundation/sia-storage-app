/*
 * The anchor: the bookmark a storage-provider shell hands back to resume the
 * change feed. Opaque to the shell; this file is its whole definition.
 *
 * It carries a position on the edit clock and a fingerprint of the folder set,
 * as `updatedAt:id:folders`. Both ids are `uniqueId()` base36 and the
 * fingerprint is count-and-hash, so the two delimiters are unambiguous; the id
 * is still parsed positionally, first colon and last, so an unexpected colon
 * inside it costs nothing.
 */
import type { ProviderChangeCursor } from '../db/operations'

export type ProviderAnchor = ProviderChangeCursor & {
  /** Fingerprint of the folder set the shell last saw. Empty means unknown. */
  folders: string
}

export const ANCHOR_START: ProviderAnchor = { updatedAt: 0, id: '', folders: '' }

/**
 * Reads an anchor off the wire. An unreadable one starts from the beginning,
 * which costs a full pass and loses nothing. An anchor with no folder field
 * never expires, which keeps the first call after a listing from asking for
 * another one.
 */
export function parseAnchor(anchor: string): ProviderAnchor {
  const first = anchor.indexOf(':')
  const last = anchor.lastIndexOf(':')
  const clock = first === -1 ? anchor : anchor.slice(0, first)
  // Whole segment or nothing: parseInt would read "12abc" as 12 and resume from
  // a position the shell never reached, quietly skipping everything before it.
  if (!/^\d+$/.test(clock)) return ANCHOR_START
  const updatedAt = Number.parseInt(clock, 10)
  if (!Number.isSafeInteger(updatedAt)) return ANCHOR_START
  if (first === -1) return { updatedAt, id: '', folders: '' }
  if (first === last) return { updatedAt, id: anchor.slice(first + 1), folders: '' }
  return { updatedAt, id: anchor.slice(first + 1, last), folders: anchor.slice(last + 1) }
}

export function formatAnchor(cursor: ProviderChangeCursor, folders: string): string {
  return `${cursor.updatedAt}:${cursor.id}:${folders}`
}

/**
 * Summarises a folder set, small enough to carry in an anchor.
 *
 * The count rides along because a hash alone collides silently, and a
 * collision reads as a folder set that did not change, which is a deleted
 * folder left on screen.
 */
export function folderFingerprint(ids: string[]): string {
  // 32-bit FNV-1a; the constants are its published offset basis and prime.
  let hash = 0x811c9dc5
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i += 1) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193)
    }
    hash = Math.imul(hash ^ 0x2c, 0x01000193)
  }
  return `${ids.length}-${(hash >>> 0).toString(36)}`
}
