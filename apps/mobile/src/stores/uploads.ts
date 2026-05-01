import type { UploadEntry, UploadStatus } from '@siastorage/core/app'
import { createProgressThrottle } from '@siastorage/core/lib/progressThrottle'
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
  packerCount: number
  pendingCount: number
  percentDecimal: number
} {
  const enabled = useAutoScanUploads()
  const activeUploads = useActiveUploads()
  const localOnlyStats = useFileStatsLocal({ localOnly: true })
  const importingCountQuery = useFileCountImporting()
  const isEnabled = enabled.data ?? false
  const packerUploads = activeUploads.filter((u) => ACTIVE_STATUSES.includes(u.status))
  const packerCount = packerUploads.length
  const packerTotalBytes = packerUploads.reduce((s, u) => s + u.size, 0)
  const packerWeightedProgress = packerUploads.reduce((s, u) => s + u.progress * u.size, 0)
  const percentDecimal = packerTotalBytes > 0 ? packerWeightedProgress / packerTotalBytes : 0
  const importingCount = importingCountQuery.data ?? 0
  const localOnlyCount = localOnlyStats.data?.count ?? 0
  const pendingCount = importingCount + localOnlyCount

  return {
    show: isEnabled && (packerCount > 0 || pendingCount > 0),
    packerCount,
    pendingCount,
    percentDecimal,
  }
}
