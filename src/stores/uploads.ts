import { create } from 'zustand'
import { logger } from '../lib/logger'
import { acquireUploadSlot } from '../managers/uploadsPool'
import { createGetterAndSelector } from '../lib/selectors'

export type UploadStatus = 'queued' | 'running' | 'done' | 'error'

export type UploadState = {
  id: string
  controller: AbortController
  status: UploadStatus
  progress: number
  error?: string
}

type UploadsStore = {
  uploads: Record<string, UploadState>
}

export const useUploadsStore = create<UploadsStore>(() => ({ uploads: {} }))

const { getState, setState } = useUploadsStore

function registerUpload(id: string): AbortController {
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

function setUploadState(
  id: string,
  status: UploadStatus,
  progress: number,
  err?: string
) {
  setState((state) => {
    const prev = state.uploads[id]
    const next: UploadState = {
      id,
      controller: prev.controller,
      status,
      progress,
      error: status === 'error' ? err ?? prev.error ?? '' : undefined,
    }
    return { uploads: { ...state.uploads, [id]: next } }
  })
}

function removeUpload(id: string) {
  setState((state) => {
    const { [id]: _, ...rest } = state.uploads
    return { uploads: rest }
  })
}

export function cancelAllUploads() {
  const current = getState().uploads
  Object.values(current).forEach((r) => {
    try {
      logger.log('aborting upload', r.id)
      r.controller?.abort()
    } catch (e) {
      logger.log('error aborting upload', r.id, e)
    }
  })
  useUploadsStore.setState({ uploads: {} })
}

export type UploadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

export const [getUploadCounts, useUploadCounts] = createGetterAndSelector(
  useUploadsStore,
  (state): UploadCounts => {
    const counts: UploadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
    for (const rec of Object.values(state.uploads)) {
      if (rec.status === 'running') counts.totalActive += 1
      if (rec.status === 'queued') counts.totalQueued += 1
    }
    counts.total = counts.totalActive + counts.totalQueued
    return counts
  }
)

export async function runUploadWithSlot<T>(params: {
  id: string
  task: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const { id, task } = params
  const controller = registerUpload(id)
  setUploadState(id, 'queued', 0)
  const release = await acquireUploadSlot()
  try {
    logger.log('upload running', id)
    setUploadState(id, 'running', 0)
    const result = await task(controller.signal)
    logger.log('upload success', id)
    removeUpload(id)
    return result
  } catch (e) {
    logger.log('upload error', id, e)
    const message = e instanceof Error ? e.message : String(e)
    setUploadState(id, 'error', 0, message)
    throw e
  } finally {
    release()
    removeUpload(id)
  }
}

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
  (state, id: string): UploadState | undefined => state.uploads[id]
)

export const [getActiveUploads, useActiveUploads] = createGetterAndSelector(
  useUploadsStore,
  (state): UploadState[] => {
    return Object.values(state.uploads).filter((rec) =>
      ['queued', 'running'].includes(rec.status)
    )
  }
)
