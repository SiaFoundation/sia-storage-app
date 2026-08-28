import { INSUFFICIENT_SPACE_MESSAGE } from '@siastorage/core/config'
import { useSdk } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import { getOneObject } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { app } from '../stores/appService'

/** Non-hook version for programmatic downloads (e.g., bulk operations) */
export async function downloadFile(file: FileRecord, priority?: number): Promise<void> {
  await app().downloads.downloadFile(file.id, priority)
}

export function useDownload(
  file?: FileRecord | null,
  priority?: number,
  opts?: {
    /**
     * Toast when the download won't fit. Only for explicit, user-tapped
     * downloads. Automatic callers (thumbnail prefetch, view auto-download)
     * leave this off so a whole library grid of unfittable thumbs can't spray
     * toasts; they bail silently. Either way the space check still runs, so a
     * doomed download never starts.
     */
    notifyOnInsufficientSpace?: boolean
  },
) {
  const toast = useToast()
  const { data: isConnected } = useSdk()
  const notify = opts?.notifyOnInsufficientSpace ?? false
  return useCallback(async () => {
    if (!file) return
    if (!isConnected) return
    const obj = getOneObject(file)
    if (!obj) {
      if (notify) toast.show('No slabs available for this file')
      return
    }
    // Check space up front and bail rather than starting a download that would
    // fail partway. execute() keeps a backstop guard for programmatic callers
    // that don't come through here. The callback is often invoked without being
    // awaited (auto-download effects), so a rejecting probe must be caught here
    // or it becomes an unhandled rejection; on a probe error, fall through to
    // the download (execute()'s backstop still guards it).
    try {
      const hasSpace = await app().downloads.checkSpaceFor([file.size])
      if (!hasSpace) {
        if (notify) toast.show(INSUFFICIENT_SPACE_MESSAGE)
        return
      }
    } catch (e) {
      logger.error('download', 'space_check_failed', { id: file.id, error: e as Error })
    }
    downloadFile(file, priority).catch((e) => {
      logger.error('download', 'failed', { id: file.id, error: e as Error })
    })
  }, [isConnected, file, toast, priority, notify])
}

export function useDownloadFromShareURL() {
  return useCallback(async (id: string, sharedUrl: string) => {
    await app().downloads.downloadFromShareUrl(id, sharedUrl)
    return id
  }, [])
}
