/*
 * Keeping one copy of a file on a device that has two places for it.
 *
 * The cache is this app's own folder and the mount is the folder a file
 * manager shows, where the operating system keeps its own copy of each file
 * opened or created there. A version waiting to upload stays in the cache,
 * because the uploader reads only the cache and the mount's file can change
 * or go at any moment. Once a version has an object on the current indexer
 * and the mount holds it whole, the cache copy is a second copy, and this
 * file removes it.
 *
 * It is removed as soon as that is known, not left for the cache limit. The
 * system drops a file from the mount without saying so first, and a cache
 * copy left behind would then take the file's full size on disk, since on
 * macOS the two copies share disk blocks only while both exist.
 */
import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { FS_EVICTION_THUMBNAIL_WAIT } from '../config'
import type { SecondCopy } from '../db/operations'
import { ThumbSizes } from '../types/files'

const BATCH = 100

/**
 * Removes the cache copies that are second copies: those of `fileIds`, or
 * every one when none are named. A no-op on a library with no mount.
 */
export async function tidyCopies(
  app: AppService,
  opts: { fileIds?: string[]; signal?: AbortSignal } = {},
): Promise<void> {
  if (opts.fileIds?.length === 0 || !(await app.settings.getMount())) return
  let removed = 0
  let after: string | null = null
  while (!opts.signal?.aborted) {
    const copies = await app.mountCopies.secondCopies(await app.settings.getIndexerURL(), {
      fileIds: opts.fileIds,
      after,
      limit: BATCH,
    })
    for (const copy of copies) {
      if (opts.signal?.aborted) break
      if (await remove(app, copy)) removed++
    }
    if (copies.length < BATCH) break
    after = copies[copies.length - 1].fileId
  }
  if (removed === 0) return
  // List rows carry the on-device flag from the query itself, so they show a
  // removed copy as cached until they refetch.
  await app.caches.library.invalidateAll()
  app.caches.libraryVersion.invalidate()
}

/**
 * Removes one second copy, unless something still needs it. A copy a
 * download or a fetch holds is skipped rather than waited for, and the next
 * pass reaches it.
 */
async function remove(app: AppService, copy: SecondCopy): Promise<boolean> {
  try {
    if (await thumbnailsPending(app, copy)) return false
    // The batch was read against the indexer current at the time. After a
    // switch since then this version may not be on the new one, and the
    // uploader, which reads only the cache, could never send it there.
    const indexerURL = await app.settings.getIndexerURL()
    if ((await app.localObjects.countForFileOnIndexer(copy.fileId, indexerURL)) === 0) return false
    return await app.fs.removeFile({ id: copy.fileId, type: copy.type }, { skipIfLocked: true })
  } catch (e) {
    logger.error('localCopies', 'tidy_failed', { fileId: copy.fileId, error: e as Error })
    return false
  }
}

/**
 * Whether the thumbnail scanner may still want this copy. It makes a file's
 * thumbnails from the cache copy, and a file added in the mount can upload
 * within seconds, before the scanner has reached it. The wait is the cache
 * limit's own, `FS_EVICTION_THUMBNAIL_WAIT` from when the copy was added, so
 * a file whose thumbnail always fails still loses its second copy.
 */
async function thumbnailsPending(app: AppService, copy: SecondCopy): Promise<boolean> {
  if (!app.thumbnails.allowedTypes.includes(copy.type)) return false
  if (Date.now() - copy.addedAt >= FS_EVICTION_THUMBNAIL_WAIT) return false
  const sizes = await app.thumbnails.getSizesForFile(copy.fileId)
  return ThumbSizes.some((size) => !sizes.includes(size))
}
