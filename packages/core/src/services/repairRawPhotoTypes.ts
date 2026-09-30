import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { retypeFile } from './retypeFile'

/**
 * Gives raw photos stored as TIFF the type their name gives. Byte detection
 * once typed a DNG, CR2, NEF, NRW, ARW or PEF by the TIFF signature they all
 * begin with, and an iPhone's thumbnail scanner rewrote such a photo to TIFF,
 * so a library can hold them under the wrong type. Current detection gives the
 * name's raw type for these bytes, so every device that runs this writes the
 * same type and they agree whichever write sync keeps.
 *
 * Sync-down runs it once per app instance through repairRawPhotoTypesOnce, and
 * the type index keeps the lookup to TIFF rows. A TIFF-typed raw that arrives
 * after that run, such as one synced from a device that has not updated, waits
 * for the next launch.
 */
export async function repairRawPhotoTypes(app: AppService, signal?: AbortSignal): Promise<number> {
  const rows = await app.files.getRawPhotosStoredAsTiff()
  // Each write skips its cache invalidation, since one per row would refetch
  // the library once per photo. The loop is followed by one for all of them.
  const write = { skipInvalidation: true } as const
  const repaired: string[] = []
  for (const row of rows) {
    // Suspension closes the database. The rows left still match next time.
    if (signal?.aborted) break
    try {
      // retypeFile moves the local copy with the type. Bytes at the TIFF path
      // decide it and not the fs row, which can outlive them, and a move with
      // nothing to move fails and rolls the type back.
      const held = (await app.fs.sizeOnDisk({ id: row.id, type: 'image/tiff' })) !== null
      if (held) await retypeFile(app, row.id, 'image/tiff', row.type, write)
      else
        await app.files.update({ id: row.id, type: row.type }, { updatedAt: 'preserve', ...write })
      repaired.push(row.id)
    } catch (e) {
      logger.warn('repairRawPhotoTypes', 'repair_failed', { fileId: row.id, error: e as Error })
    }
  }
  if (repaired.length > 0) {
    for (const id of repaired) app.caches.fileById.invalidate(id)
    app.caches.libraryVersion.invalidate()
    logger.info('repairRawPhotoTypes', 'repaired', { repaired: repaired.length })
  }
  return repaired.length
}

const repairedApps = new WeakSet<AppService>()

/**
 * Runs the repair the first time it is called for an app instance. Sync-down
 * calls it after each pass that reaches the end of the event stream. A run cut
 * short by suspension leaves the app unmarked, so the next such pass finishes it.
 */
export async function repairRawPhotoTypesOnce(app: AppService, signal: AbortSignal): Promise<void> {
  if (repairedApps.has(app)) return
  repairedApps.add(app)
  try {
    await repairRawPhotoTypes(app, signal)
  } catch (e) {
    logger.warn('repairRawPhotoTypes', 'run_failed', { error: e as Error })
  }
  if (signal.aborted) repairedApps.delete(app)
}
