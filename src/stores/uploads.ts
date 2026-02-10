import { create } from 'zustand'
import { logger } from '../lib/logger'
import { createGetterAndSelector } from '../lib/selectors'
import { humanUploadPercent } from '../lib/uploadPercent'
import { useFileCountAll, useFileCountLocal } from './files'
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
let uploadRafScheduled = false

function flushUploadProgress() {
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
    uploadRafScheduled = false
    return { uploads }
  })
}

/**
 * Immediately flush any pending progress updates.
 * Primarily used for testing where RAF may not work correctly.
 */
export function flushPendingUploadProgress(): void {
  flushUploadProgress()
}

export function registerUpload(id: string): void {
  setState((state) => {
    const next: UploadState = {
      id,
      status: 'queued',
      progress: 0,
    }
    return { uploads: { ...state.uploads, [id]: next } }
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
  if (!uploadRafScheduled) {
    uploadRafScheduled = true
    requestAnimationFrame(flushUploadProgress)
  }
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
  percentComplete: string
  total: number
} {
  const total = useFileCountAll()
  const localOnly = useFileCountLocal({ localOnly: true })
  const enabled = useAutoScanUploads()
  const activeUploads = useActiveUploads()
  const totalCount = total.data ?? 0
  const localOnlyCount = localOnly.data ?? 0
  const uploadedCount = totalCount - localOnlyCount
  const isEnabled = enabled.data ?? false
  const activeProgress = activeUploads
    .map((u) => u.progress)
    .reduce((a, b) => a + b, 0)
  const percentComplete = totalCount
    ? (activeProgress + uploadedCount) / totalCount
    : 0

  return {
    show: isEnabled && !!localOnlyCount,
    enabled: isEnabled,
    remaining: localOnlyCount,
    percentComplete: humanUploadPercent(percentComplete),
    total: total.data ?? 0,
  }
}
