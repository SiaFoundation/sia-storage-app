/*
 * A thumbnail's bytes for a caller that cannot open the file itself: the File
 * Provider extension, which the sandbox keeps out of the cache, and the
 * desktop app's windows, whose renderer reads nothing from disk. Both get the
 * bytes over a socket, base64 in one message.
 */

import type { FsIOAdapter } from '../../services/fsFileUri'
import type { LocalCopyLock } from '../../services/localCopyLock'
import type { FileRecord } from '../../types/files'
import type { AppCaches } from '../service'
import type { DownloadPriority } from '../stores'

/**
 * Every generator writes a 512px thumbnail far below this. A larger row is
 * malformed and is refused rather than sent over the socket as one line.
 */
export const MAX_INLINE_THUMBNAIL_BYTES = 1024 * 1024

export type ThumbnailBytes = ReturnType<typeof buildThumbnailBytes>

export function buildThumbnailBytes(deps: {
  fsIO: FsIOAdapter
  localCopyLock: LocalCopyLock
  downloadFile: (fileId: string, priority: DownloadPriority) => Promise<void>
  caches: Pick<AppCaches, 'libraryVersion'>
}) {
  async function isLocal(thumb: { id: string; type: string; size: number }) {
    return (await deps.fsIO.size(thumb.id, thumb.type)).value === thumb.size
  }

  /**
   * Downloads a thumbnail, then signals the change feed. A download moves no
   * library counter, and the change signal a shell waits on fires only when
   * one moves. Without it the shell never reads the feed, so the file's new
   * date never reaches Finder, which matters whenever Finder already got an
   * error: from a failed request, or from the extension giving up on a slow
   * download that later finishes.
   */
  async function download(thumb: FileRecord, priority: DownloadPriority) {
    await deps.downloadFile(thumb.id, priority)
    deps.caches.libraryVersion.invalidate()
  }

  /**
   * The thumbnail's bytes, downloaded first at user priority when they are
   * not on this device, or null when they are still missing after that.
   * Throws when the download fails.
   */
  async function read(thumb: FileRecord): Promise<Uint8Array | null> {
    const readFile = deps.fsIO.readFile
    if (!readFile) throw new Error('This host cannot read thumbnails')
    // At user priority, because a background download dropped from its queue
    // would leave the icon plain until the file changed.
    if (!(await isLocal(thumb))) await download(thumb, 'user')
    // Under the lock, so eviction of a trashed file's thumbnails cannot
    // remove the bytes between the size check and the read.
    return deps.localCopyLock.run(thumb.id, async () =>
      (await isLocal(thumb)) ? readFile(thumb) : null,
    )
  }

  return { isLocal, download, read }
}
