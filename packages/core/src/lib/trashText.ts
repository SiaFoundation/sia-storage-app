/*
 * The words every app uses for an entry in the trash.
 */

import type { RestoredFile, TrashEntry } from '../types/files'

const DAY_MS = 24 * 60 * 60 * 1000

/** How many entries, as the trash's heading and its Empty Trash confirmation count them. */
export function itemCount(n: number): string {
  return n === 1 ? '1 item' : `${n.toLocaleString()} items`
}

/** When the trash deletes the entry for good, counted in whole days. */
export function purgeLabel(purgeAt: number, now: number): string {
  const days = Math.ceil((purgeAt - now) / DAY_MS)
  if (days <= 0) return 'Deleted soon'
  return days === 1 ? 'Deleted in 1 day' : `Deleted in ${days} days`
}

/** The entry's folder, its version count when it has more than one, and when it is deleted for good. */
export function trashEntryDetail(entry: TrashEntry, now: number): string {
  return [
    entry.folder ?? 'No folder',
    entry.versions > 1 ? `${entry.versions} versions` : null,
    purgeLabel(entry.purgeAt, now),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * What to tell the user after restoring the entry named `name`. `restored`
 * is empty when the entry left the trash before the restore ran, deleted on
 * another device or by the 30-day purge.
 */
export function restoredText(name: string, restored: RestoredFile[]): string {
  const [file] = restored
  if (!file) return `${name} is no longer in the trash.`
  if (file.renamedFrom) return `Restored as ${file.name}, since the name is taken.`
  return `Restored ${name}.`
}
