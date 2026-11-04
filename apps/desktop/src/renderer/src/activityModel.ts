/*
 * What the popover's activity list says about each recent file, and the
 * settings its one-click share button makes links with. Kept apart from the
 * view so both can be tested without rendering it.
 */

import { EXPIRY_CHOICES, type ExpiryChoice } from '@siastorage/core/lib/shareLinkText'
import type { UploadEntry } from '@siastorage/core/app'
import type { RecentFile, ShareLinkMode } from '@siastorage/core/types'

/*
 * The words follow the status window and the phone app. A file is added when
 * it enters the library, uploaded once its object is on the network, and
 * "synced" is kept for the encrypted metadata, so it never describes a file.
 */
export type FileActivity =
  | { kind: 'uploading'; progress: number }
  | { kind: 'preparing' }
  | { kind: 'waiting' }
  | { kind: 'failed' }
  | { kind: 'uploaded' }
  | { kind: 'unavailable' }

/**
 * Where a file's bytes are. An upload under way outranks the library's flags,
 * because the uploader holds an entry only while it works on the file, and
 * the library learns the file is uploaded only once the object is written.
 * A file on this Mac with no entry yet is one the uploader has not picked up.
 * Packing shows no progress, because progress counts bytes sent to hosts.
 * A lost file outranks its entry too: the uploader leaves a failed entry
 * behind when it gives up on a file, such as an empty one, and nothing will
 * retry it.
 */
export function fileActivity(file: RecentFile, upload: UploadEntry | undefined): FileActivity {
  if (file.lost && !file.uploaded) return { kind: 'unavailable' }
  if (!file.uploaded && upload) {
    if (upload.status === 'error') return { kind: 'failed' }
    if (upload.status === 'uploading') return { kind: 'uploading', progress: upload.progress }
    if (upload.status === 'packing' || upload.status === 'packed') return { kind: 'preparing' }
    if (upload.status === 'queued') return { kind: 'waiting' }
  }
  if (file.uploaded) return { kind: 'uploaded' }
  return file.local ? { kind: 'waiting' } : { kind: 'unavailable' }
}

/** What a file's state is called, as the status window and the phone app call it. */
export function activityLabel(activity: FileActivity): string {
  switch (activity.kind) {
    case 'uploading':
      return `Uploading ${Math.floor(Math.min(1, Math.max(0, activity.progress)) * 100)}%`
    case 'preparing':
      return 'Preparing to upload'
    case 'waiting':
      return 'Waiting to upload'
    case 'failed':
      return 'Upload error'
    case 'uploaded':
      return 'Uploaded'
    case 'unavailable':
      return 'Unavailable'
  }
}

/**
 * A name split before its extension, for cutting the part before it. A
 * leading dot is part of the name, as in `.env`, and an extension longer
 * than 8 characters is treated as part of the name, so a dotted name such as
 * `notes.from.the.meeting` keeps more than its last word.
 */
export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || name.length - dot > 9) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** When a file arrived, as a list of recent things says it: "5 min ago", "Yesterday", "Mar 4". */
export function addedLabel(addedAt: number, now: number): string {
  const ago = now - addedAt
  if (ago < MINUTE) return 'Just now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  if (ago < DAY) return `${Math.floor(ago / HOUR)} hr ago`
  if (ago < 2 * DAY) return 'Yesterday'
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)} days ago`
  const date = new Date(addedAt)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * The line under a file's name: when an uploaded file was added to the
 * library, and otherwise the state alone, since the popover is too narrow for
 * both and the list's order already shows which files are new.
 */
export function rowDetail(activity: FileActivity, addedAt: number, now: number): string {
  if (activity.kind !== 'uploaded') return activityLabel(activity)
  const when = addedLabel(addedAt, now)
  return `Added ${when === 'Just now' || when === 'Yesterday' ? when.toLowerCase() : when}`
}

export type QuickShare = { mode: ShareLinkMode; expiry: ExpiryChoice }

/** A link to this version of the file that never expires. */
export const DEFAULT_QUICK_SHARE: QuickShare = { mode: 'snapshot', expiry: 'never' }

const QUICK_SHARE_KEY = 'activity.quickShare'

/**
 * The settings the share button uses, as last chosen in its options. Read
 * from storage this page owns, so a value an older build wrote, or any other
 * shape, falls back to the default rather than reaching `createLink`.
 */
export function loadQuickShare(storage: Pick<Storage, 'getItem'>): QuickShare {
  try {
    const raw = JSON.parse(storage.getItem(QUICK_SHARE_KEY) ?? 'null') as Partial<QuickShare>
    const mode = raw?.mode === 'latest' || raw?.mode === 'snapshot' ? raw.mode : null
    const expiry = EXPIRY_CHOICES.find((c) => c.id === raw?.expiry)?.id ?? null
    if (mode && expiry) return { mode, expiry }
  } catch {
    // Unparseable storage is the same as none.
  }
  return DEFAULT_QUICK_SHARE
}

export function saveQuickShare(storage: Pick<Storage, 'setItem'>, choice: QuickShare): void {
  storage.setItem(QUICK_SHARE_KEY, JSON.stringify(choice))
}

/** The expiry choices longest first, so the default sits at the left of the control. */
export const QUICK_EXPIRY_CHOICES = [...EXPIRY_CHOICES].reverse()

export const QUICK_MODE_CHOICES: ReadonlyArray<{ id: ShareLinkMode; label: string }> = [
  { id: 'snapshot', label: 'This version' },
  { id: 'latest', label: 'Latest version' },
]
