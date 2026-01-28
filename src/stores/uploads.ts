import { create } from 'zustand'
import { logger } from '../lib/logger'
import { createGetterAndSelector } from '../lib/selectors'

export type UploadStatus =
  | 'queued' // In queue, waiting to be added to packer
  | 'packing' // Being streamed to packer
  | 'packed' // Added to packer, waiting for batch finalize
  | 'uploading' // Batch finalizing (uploading slabs to network)
  | 'done' // Complete
  | 'error' // Failed

export type UploadState = {
  id: string
  controller: AbortController
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

const { getState, setState } = useUploadsStore

export function registerUpload(id: string): AbortController {
  const controller = new AbortController()
  setState((state) => {
    const next: UploadState = {
      id,
      controller,
      status: 'queued',
      progress: 0,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
  return controller
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

export function cancelAllUploads() {
  const current = getState().uploads
  Object.values(current).forEach((r) => {
    try {
      logger.debug('uploads', 'aborting upload', r.id)
      r.controller?.abort()
    } catch (e) {
      logger.error('uploads', 'error aborting upload', r.id, e)
    }
  })
  useUploadsStore.setState({ uploads: {} })
}

export function cancelUpload(id: string) {
  const current = getState().uploads
  const rec = current[id]
  if (!rec) return
  logger.debug('uploads', 'aborting upload', id)
  rec.controller?.abort()
  removeUpload(id)
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
  setState((state) => {
    const prev = state.uploads[id]
    if (!prev) return state
    const next: UploadState = {
      id,
      controller: prev.controller,
      status: prev.status,
      progress,
      error: prev.error,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
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
