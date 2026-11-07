import type { UploadEntry, UploadStatus } from '@siastorage/core/app'
import { createProgressThrottle } from '@siastorage/core/lib/progressThrottle'
import { filesWaitingToUpload, summarizeUploads } from '@siastorage/core/lib/uploadActivity'
import { useAutoScanUploads, useUploadEntry } from '@siastorage/core/stores'
import useSWR from 'swr'
import { app } from './appService'
import { useFileCountImporting, useFileStatsLocal } from './files'

export type UploadState = UploadEntry

export type UploadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

const ACTIVE_STATUSES: UploadStatus[] = ['packing', 'packed', 'uploading']

export function getUploadCounts(): UploadCounts {
  const { uploads } = app().uploads.getState()
  const counts: UploadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
  for (const rec of Object.values(uploads)) {
    if (ACTIVE_STATUSES.includes(rec.status)) counts.totalActive += 1
    if (rec.status === 'queued') counts.totalQueued += 1
  }
  counts.total = counts.totalActive + counts.totalQueued
  return counts
}

export function useUploadCounts(): UploadCounts {
  const { data } = useSWR(app().caches.uploads.key('counts'), () => getUploadCounts())
  return data ?? { total: 0, totalActive: 0, totalQueued: 0 }
}

export function useUploadState(id: string): UploadState | undefined {
  const { data } = useUploadEntry(id)
  return data
}

const uploadProgress = createProgressThrottle(
  (id, progress) => app().uploads.update(id, { progress }),
  (cb) => requestAnimationFrame(cb),
)

export const flushPendingUploadProgress = uploadProgress.flush
export const updateUploadProgress = uploadProgress.set

export function getActiveUploads(): UploadState[] {
  const { uploads } = app().uploads.getState()
  return Object.values(uploads).filter((rec) =>
    ['queued', 'packing', 'packed', 'uploading'].includes(rec.status),
  )
}

export function useActiveUploads(): UploadState[] {
  const { data } = useSWR(app().caches.uploads.key('active'), () => getActiveUploads())
  return data ?? []
}

export function useUploadProgress(): {
  show: boolean
  /** Total active uploads, including thumbnails — drives whether to show a state. */
  packerCount: number
  /** Active uploads that are real files (excludes thumbnails) — drives the count. */
  packerFileCount: number
  /** Total bytes of those files, matching packerFileCount's set. */
  packerFileBytes: number
  /** Total pending (importing + local-only) including thumbnails — drives show. */
  pendingCount: number
  /** Files still being copied in by an import. */
  importingFileCount: number
  /** Files on the device with no copy on the network, not being sent now. */
  waitingFileCount: number
  percentDecimal: number
} {
  const enabled = useAutoScanUploads()
  const isEnabled = enabled.data ?? false
  // When auto-scan is off the status line never shows, so skip the DB queries
  // entirely rather than fetching counts we'll discard.
  const pausedWhenDisabled = { isPaused: () => !isEnabled }
  const uploads = summarizeUploads(useActiveUploads())
  // Total local-only count includes thumbnails (keeps the indicator visible
  // while only thumbnails remain); the files-only count drives the number.
  const localOnlyStats = useFileStatsLocal({ localOnly: true }, pausedWhenDisabled)
  const localOnlyFileStats = useFileStatsLocal(
    { localOnly: true, includeThumbnails: false },
    pausedWhenDisabled,
  )
  const importingCountQuery = useFileCountImporting(pausedWhenDisabled)
  // The in-flight import count comes from import_files rows, which never
  // include thumbnails.
  const importingFileCount = importingCountQuery.data ?? 0
  const localOnlyCount = localOnlyStats.data?.count ?? 0
  const localOnlyFileCount = localOnlyFileStats.data?.count ?? 0

  return {
    show: isEnabled && (uploads.active > 0 || importingFileCount + localOnlyCount > 0),
    packerCount: uploads.active,
    packerFileCount: uploads.activeFiles,
    packerFileBytes: uploads.activeFileBytes,
    pendingCount: importingFileCount + localOnlyCount,
    importingFileCount,
    waitingFileCount: filesWaitingToUpload(uploads, localOnlyFileCount),
    percentDecimal: uploads.progress,
  }
}
