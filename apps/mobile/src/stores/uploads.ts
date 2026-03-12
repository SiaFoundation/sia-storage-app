import { createDebouncedAction } from '@siastorage/core/lib/debouncedAction'
import { logger } from '@siastorage/logger'
import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'
import { humanUploadPercent } from '../lib/uploadPercent'
import {
  useFileCountAll,
  useFileCountLocal,
  useFileStatsAll,
  useFileStatsLocal,
} from './files'
import { useAutoScanUploads } from './settings'

export type UploadStatus =
  | 'queued' // In queue, waiting to be added to packer
  | 'packing' // Being streamed to packer
  | 'packed' // Added to packer, waiting for batch finalize
  | 'uploading' // Batch finalizing (uploading slabs to network)
  | 'done' // Complete
  | 'error' // Failed

export type UploadState = {
  id: string
  size: number
  status: UploadStatus
  progress: number
  error?: string
  batchId?: string // Which batch this file belongs to
  batchFileCount?: number // Number of files in the current batch
}

type UploadsStore = {
  uploads: Record<string, UploadState>
}

export const useUploadsStore = create<UploadsStore>(() => ({ uploads: {} }))

const { setState } = useUploadsStore

const pendingUploadProgress = new Map<string, number>()

function applyPendingUploadProgress() {
  if (pendingUploadProgress.size === 0) return
  setState((state) => {
    const uploads = { ...state.uploads }
    for (const [id, progress] of pendingUploadProgress) {
      const prev = uploads[id]
      if (prev) {
        uploads[id] = { ...prev, progress }
      }
    }
    pendingUploadProgress.clear()
    return { uploads }
  })
}

const uploadProgressFlusher = createDebouncedAction(
  applyPendingUploadProgress,
  1000,
)

export const flushPendingUploadProgress = uploadProgressFlusher.flush

export function registerUpload(id: string, size: number): void {
  setState((state) => {
    const next: UploadState = {
      id,
      size,
      status: 'queued',
      progress: 0,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
}

export function registerUploads(
  entries: Array<{ id: string; size: number }>,
): void {
  if (entries.length === 0) return
  setState((state) => {
    const uploads = { ...state.uploads }
    for (const { id, size } of entries) {
      uploads[id] = { id, size, status: 'queued', progress: 0 }
    }
    return { uploads }
  })
}

export function setUploadStatus(id: string, status: UploadStatus) {
  setState((state) => {
    const prev = state.uploads[id]
    if (!prev) return state
    const next: UploadState = {
      ...prev,
      status,
      error: status === 'error' ? prev.error : undefined,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
}

export function setUploadError(id: string, error: string) {
  setState((state) => {
    const prev = state.uploads[id]
    if (!prev) return state
    const next: UploadState = {
      ...prev,
      status: 'error',
      error,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
}

export function setUploadBatchInfo(
  id: string,
  batchId: string,
  batchFileCount: number,
) {
  setState((state) => {
    const prev = state.uploads[id]
    if (!prev) return state
    const next: UploadState = {
      ...prev,
      batchId,
      batchFileCount,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
}

export function setBatchUploading(fileIds: string[], batchId: string): void {
  if (fileIds.length === 0) return
  setState((state) => {
    const uploads = { ...state.uploads }
    for (const id of fileIds) {
      const prev = uploads[id]
      if (prev) {
        uploads[id] = {
          ...prev,
          status: 'uploading',
          batchId,
          batchFileCount: fileIds.length,
        }
      }
    }
    return { uploads }
  })
}

export function removeUpload(id: string) {
  setState((state) => {
    const { [id]: _, ...rest } = state.uploads
    return { uploads: rest }
  })
}

/**
 * Remove multiple uploads in a single state update.
 * This prevents UI flickering when batch uploads complete.
 */
export function removeUploads(ids: string[]) {
  if (ids.length === 0) return
  setState((state) => {
    const next = { ...state.uploads }
    for (const id of ids) {
      delete next[id]
    }
    return { uploads: next }
  })
}

export function clearAllUploads() {
  logger.debug('uploads', 'cancel_all')
  useUploadsStore.setState({ uploads: {} })
}

export type UploadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

// Active statuses for counting uploads in progress
const ACTIVE_STATUSES: UploadStatus[] = ['packing', 'packed', 'uploading']

export const [getUploadCounts, useUploadCounts] = createGetterAndSelector(
  useUploadsStore,
  (state): UploadCounts => {
    const counts: UploadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
    for (const rec of Object.values(state.uploads)) {
      if (ACTIVE_STATUSES.includes(rec.status)) counts.totalActive += 1
      if (rec.status === 'queued') counts.totalQueued += 1
    }
    counts.total = counts.totalActive + counts.totalQueued
    return counts
  },
)

export function updateUploadProgress(id: string, progress: number) {
  pendingUploadProgress.set(id, progress)
  uploadProgressFlusher.trigger()
}

export const [getUploadState, useUploadState] = createGetterAndSelector(
  useUploadsStore,
  (state, id: string): UploadState | undefined => state.uploads[id],
)

export const [getActiveUploads, useActiveUploads] = createGetterAndSelector(
  useUploadsStore,
  (state): UploadState[] => {
    return Object.values(state.uploads).filter((rec) =>
      ['queued', 'packing', 'packed', 'uploading'].includes(rec.status),
    )
  },
)

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
