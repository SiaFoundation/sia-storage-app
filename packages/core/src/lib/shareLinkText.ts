/*
 * The words and choices every app uses for share links: what a new link can
 * show and how long it can last, and how a link already made is named and
 * described in a list.
 */

import type { ShareLink, ShareLinkMode } from '../types/shareLinks'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long a new link lasts. The indexer fixes a link's expiry when it is
 * made, so changing it later means making a new link.
 */
export const EXPIRY_CHOICES = [
  { id: 'day', label: '1 day', ms: DAY_MS },
  { id: 'week', label: '1 week', ms: 7 * DAY_MS },
  { id: 'month', label: '30 days', ms: 30 * DAY_MS },
  { id: 'never', label: 'Never', ms: null },
] as const

export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]['id']

export const DEFAULT_EXPIRY: ExpiryChoice = 'week'

/** What a new link shows, in the words the apps use for it. */
export const MODE_CHOICES: ReadonlyArray<{ id: ShareLinkMode; label: string; detail: string }> = [
  { id: 'latest', label: 'Latest versions', detail: 'Updates when the files change' },
  { id: 'snapshot', label: 'These versions', detail: 'Stays as the files are now' },
]

export function modeLabel(mode: ShareLinkMode): string {
  return mode === 'snapshot' ? 'These versions' : 'Latest versions'
}

/** The core's own messages that are written to be read by a person. */
const SHOWN_ERRORS = ['None of these files can be shared', 'This link has expired or was revoked']

/**
 * What a failed link change says on screen. On the Mac the daemon socket and
 * Electron's IPC each wrap the core's message in text of their own, and an SDK or network
 * failure can quote internals such as the indexer's address, so a message is
 * shown only when it carries one of the core's own and `fallback` otherwise.
 */
export function shareErrorText(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  return SHOWN_ERRORS.find((shown) => message.includes(shown)) ?? fallback
}

/** The expiry to make a link with: milliseconds since the epoch, or null for never. */
export function expiresAt(choice: ExpiryChoice, now: number): number | null {
  const { ms } = EXPIRY_CHOICES.find((c) => c.id === choice) ?? EXPIRY_CHOICES[1]
  return ms === null ? null : now + ms
}

/** Named the way the share page titles it: the first file, and how many more. */
export function linkTitle(link: Pick<ShareLink, 'files'>): string {
  const [first, ...rest] = link.files
  if (!first) return 'No files'
  if (rest.length === 0) return first.name
  return `${first.name} and ${rest.length} more`
}

export function expiryLabel(expiresAtMs: number | null, now: number): string {
  if (expiresAtMs === null) return 'Never expires'
  const left = expiresAtMs - now
  if (left <= 0) return 'Expired'
  const hours = Math.ceil(left / (60 * 60 * 1000))
  if (hours < 24) return hours === 1 ? 'Expires in 1 hour' : `Expires in ${hours} hours`
  const days = Math.round(left / DAY_MS)
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`
}

/** What the link's files are waiting on, if anything. Null once recipients see them all. */
export function linkProgress(link: Pick<ShareLink, 'files'>): string | null {
  const waiting = link.files.filter((f) => f.state === 'pending').length
  const trashed = link.files.filter((f) => f.state === 'trashed').length
  const parts: string[] = []
  if (waiting > 0) parts.push(waiting === 1 ? '1 file uploading' : `${waiting} files uploading`)
  if (trashed > 0)
    parts.push(trashed === 1 ? '1 file in the trash' : `${trashed} files in the trash`)
  return parts.length > 0 ? parts.join(', ') : null
}
