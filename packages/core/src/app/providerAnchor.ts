/*
 * The anchor: the bookmark a storage-provider shell hands back to resume the
 * change feed. Opaque to the shell; this file is its whole definition.
 *
 * `epoch:feedSeq:id`, with an optional fourth segment the working-set
 * listing's file phase uses to carry its captured start position; the parse
 * accepts the segment everywhere because that cursor round-trips through
 * here between pages. The epoch names the database the anchor was minted
 * against: a wiped and recreated
 * library restarts the sequence near zero, and without the epoch a stale
 * anchor holding a large old sequence would read as "nothing changed"
 * forever instead of expiring. Every segment is colon-free (epoch and id
 * are base36), so a plain split is unambiguous.
 */
import type { ProviderChangeCursor } from '../db/operations'

export type ProviderAnchor = ProviderChangeCursor & {
  /** The fourth segment: the working-set listing's start position; empty elsewhere. */
  startSeq: string
}

/** The start of the feed, for listings that build an anchor from nothing. */
export const ANCHOR_START: ProviderAnchor = { feedSeq: 0, id: '', startSeq: '' }

/**
 * Reads an anchor off the wire against this database's epoch. Null means the
 * anchor belongs to another life of the library or to no format at all; the
 * caller expires it, and the shell relists once. The prune horizon expiry
 * lives in the changes path, not here.
 */
export function parseAnchor(anchor: string, epoch: string): ProviderAnchor | null {
  const [anchorEpoch, seq, id = '', startSeq = ''] = anchor.split(':')
  if (anchorEpoch !== epoch) return null
  // Whole segment or nothing: parseInt would read "12abc" as 12 and resume
  // from a position the shell never reached, skipping everything before it.
  if (seq === undefined || !/^\d+$/.test(seq)) return null
  const feedSeq = Number.parseInt(seq, 10)
  if (!Number.isSafeInteger(feedSeq)) return null
  return { feedSeq, id, startSeq }
}

export function formatAnchor(epoch: string, cursor: ProviderChangeCursor, startSeq = ''): string {
  const base = `${epoch}:${cursor.feedSeq}:${cursor.id}`
  return startSeq === '' ? base : `${base}:${startSeq}`
}
