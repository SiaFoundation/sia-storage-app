import type { UploadEntry, UploadStatus } from '@siastorage/core/app'
import { createProgressThrottle } from '@siastorage/core/lib/progressThrottle'
import {
  useAutoScanUploads,
  useFileCountAll,
  useFileStatsAll,
  useUploadEntry,
} from '@siastorage/core/stores'
import useSWR from 'swr'
import { humanUploadPercent } from '../lib/uploadPercent'
import { app } from './appService'
import { useFileCountLocal, useFileStatsLocal } from './files'

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
  enabled: boolean
  remaining: number
  percentDecimal: number
  percentComplete: string
  total: number
} {
  const totalCount = useFileCountAll()
  const localOnlyCount = useFileCountLocal({ localOnly: true })
  const totalStats = useFileStatsAll()
  const localOnlyStats = useFileStatsLocal({ localOnly: true })
  const enabled = useAutoScanUploads()
  const activeUploads = useActiveUploads()
  const totalFiles = totalCount.data ?? 0
  const localOnlyFiles = localOnlyCount.data ?? 0
  const totalBytes = totalStats.data?.totalBytes ?? 0
  const localOnlyBytes = localOnlyStats.data?.totalBytes ?? 0
  const uploadedBytes = totalBytes - localOnlyBytes
  const isEnabled = enabled.data ?? false
  const activeWeightedProgress = activeUploads
    .map((u) => u.progress * u.size)
    .reduce((a, b) => a + b, 0)
  const percentDecimal = totalBytes
    ? Math.min((activeWeightedProgress + uploadedBytes) / totalBytes, 1)
    : 0

  return {
    show: isEnabled && !!localOnlyFiles,
    enabled: isEnabled,
    remaining: localOnlyFiles,
    percentDecimal,
    percentComplete: humanUploadPercent(percentDecimal),
    total: totalFiles,
  }
}
