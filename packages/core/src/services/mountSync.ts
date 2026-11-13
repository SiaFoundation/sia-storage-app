/*
 * Keeping the record of what the mount holds (`mount_copies`) in step with
 * the operating system.
 *
 * The system removes a file's bytes from the mount on its own: on macOS for
 * Remove Download in Finder, or to free disk under pressure. It also writes
 * bytes this device never handed it whole, by reading a file range by range
 * until it has all of it. Rows are written as this device hands bytes over
 * (`provider.fetch`, `fetchRange`, `create`, `write`), and this file corrects
 * them from the system's own account. A file fetched whole is recorded as
 * partial until that account names it, since the system can give up on a
 * fetch after the bytes were placed for it. Its cache copy is removed once
 * the row is whole.
 *
 * Two ways in. A system that can list what it holds is read through the
 * adapter (`syncMount`): what changed since a saved cursor on every eviction
 * pass and after a hint, and the whole list once a day. A system that tells
 * its integration about each file reports through `applyMountReport`.
 *
 * A wrong row is never dangerous. A whole row for a file the mount no longer
 * holds overstates what is on the device until the next full read. Ranges the
 * system dropped on its own are named by no read, so their row stays until
 * the file's version changes or a dehydrate of it answers done. A missing row
 * understates the device until the next read adds it. A mount with no list to
 * read has only its reports, so one lost while the daemon was down leaves its
 * row wrong until a dehydrate of that file answers. Whether bytes may be
 * removed rests on the `objects` table.
 */
import { logger } from '@siastorage/logger'
import type { MountChanges } from '../adapters/mount'
import type { AppService } from '../app/service'
import { MOUNT_FULL_READ_INTERVAL, MOUNT_HINT_MIN_INTERVAL } from '../config'
import type { MountReport } from '../types/provider'
import { tidyCopies } from './localCopies'

/** The integration's notice that the mount's files changed, spaced out into reads. */
export class MountHint {
  private hinted = false
  private takenAt = 0

  hint(): void {
    this.hinted = true
  }

  /**
   * Whether an early read is due at `now`, clearing the hint when it is: a
   * hint arrived, and the last one was taken at least
   * `MOUNT_HINT_MIN_INTERVAL` ago. macOS sends its notice for every file an
   * eviction or a download touches, so reads are spaced out.
   */
  take(now: number): boolean {
    if (!this.hinted || now - this.takenAt < MOUNT_HINT_MIN_INTERVAL) return false
    this.hinted = false
    this.takenAt = now
    return true
  }
}

/**
 * Reads the system's account of the mount and applies it. A no-op on a
 * library with no mount.
 *
 * The cursor is saved only after a read succeeded and was applied, so a read
 * that fails is read again from the same place next time.
 */
export async function syncMount(app: AppService, signal?: AbortSignal): Promise<void> {
  const mount = await app.settings.getMount()
  if (!mount) return

  // Rows the library itself shows are out of date: a file with no visible
  // version, which the system deletes its copy of, and ranges of a version
  // that is no longer current, which it discards.
  await app.mountCopies.delete(await app.mountCopies.staleStackIds())

  const saved = await app.settings.getMountCursor()
  const last = saved?.mountId === mount.id ? saved : null
  const readStart = Date.now()
  let cursor = last?.cursor ?? null
  let fullAt = last?.fullAt ?? 0
  let full: string[] | null = null

  if (cursor !== null) {
    const changes = await read(app, cursor, signal)
    if (!changes) return
    cursor = changes.cursor
    if (changes.full) {
      full = changes.full
    } else {
      // Removals first: a file listed both ways was removed and written
      // again, and holds its bytes now. A row used since this read started
      // is one this device handed over after the system's list was taken.
      await app.mountCopies.delete(changes.removed ?? [], readStart)
      await app.mountCopies.markWhole(changes.added ?? [], readStart)
    }
  }

  if (full === null && (cursor === null || readStart - fullAt >= MOUNT_FULL_READ_INTERVAL)) {
    const fullRead = await read(app, null, signal)
    // A failed full read after a good change read still saves that read's
    // place, and the full read is tried again next time.
    if (!fullRead && cursor === null) return
    if (fullRead) {
      // After a change read its cursor is kept: one taken now would skip
      // removals made between the two reads.
      if (cursor === null) cursor = fullRead.cursor
      full = fullRead.full ?? []
    }
  }

  if (full !== null) {
    await applyFullList(app, full, readStart, fullAt)
    fullAt = readStart
  }

  if (cursor !== null) {
    await app.settings.setMountCursor({ mountId: mount.id, cursor, fullAt })
  }
}

/** Applies what an integration was told by the system about single files. */
export async function applyMountReport(app: AppService, report: MountReport): Promise<void> {
  if (!(await app.settings.getMount())) return
  await app.mountCopies.delete(report.dehydrated ?? [])
  // The system holds the version it was handed. When a newer one has synced
  // in since, the row still names the handed version and is left alone:
  // marking it whole would record the mount as holding bytes it was never
  // given, and the tidy below would then remove the newer version's cache copy.
  const hydrated: string[] = []
  for (const stackId of report.hydrated ?? []) {
    const [shown] = await app.provider.fileIds([stackId])
    const row = await app.mountCopies.read(stackId)
    if (shown && (!row || row.fileId === shown)) hydrated.push(stackId)
  }
  await app.mountCopies.markWhole(hydrated, Date.now())
  // A file the system now holds whole needs no cache copy once uploaded.
  await tidyCopies(app, { fileIds: await app.provider.fileIds(hydrated) })
}

/**
 * Asks the adapter for the mount's files, whole or since `cursor`. Undefined
 * when the adapter could not run or has no such read, which leaves the saved
 * cursor for next time.
 */
async function read(
  app: AppService,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<MountChanges | undefined> {
  try {
    return (await app.mount.changes(cursor, signal)) ?? undefined
  } catch (e) {
    if (!signal?.aborted) logger.error('mountSync', 'read_failed', { error: e as Error })
    return undefined
  }
}

/**
 * Makes the whole rows match a full list. A whole row the list leaves out is
 * deleted, unless it was written after the read started. A partial row is
 * kept, since a full list never names a file the system holds only ranges of.
 *
 * A file first seen here may have been held for a long time, and nothing
 * says when it was last used, so it gets the previous full read's time, or 0
 * before the first.
 */
async function applyFullList(
  app: AppService,
  fullIds: string[],
  readStart: number,
  previousFullAt: number,
): Promise<void> {
  const listed = new Set(fullIds)
  const known = new Set(await app.mountCopies.wholeStackIds())
  await app.mountCopies.delete(
    [...known].filter((stackId) => !listed.has(stackId)),
    readStart,
  )
  await app.mountCopies.markWhole(
    fullIds.filter((stackId) => !known.has(stackId)),
    previousFullAt,
  )
}
