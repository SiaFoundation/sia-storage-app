import { create } from 'zustand'
import { logger } from '../lib/logger'
import { acquireDownloadSlot } from '../managers/downloadsPool'
import { createGetterAndSelector } from '../lib/selectors'

export type DownloadStatus = 'queued' | 'running' | 'done' | 'error'

export type DownloadState = {
  id: string
  controller: AbortController
  status: DownloadStatus
  progress: number
  error?: string
}

type DownloadsStore = {
  downloads: Record<string, DownloadState>
}

export const useDownloadsStore = create<DownloadsStore>(() => ({
  downloads: {},
}))

const { getState, setState } = useDownloadsStore

function registerDownload(id: string): AbortController {
  const controller = new AbortController()
  setState((state) => {
    const next: DownloadState = {
      id,
      controller,
      status: 'queued',
      progress: 0,
    }
    return { downloads: { ...state.downloads, [id]: next } }
  })
  return controller
}

function setDownloadState(
  id: string,
  status: DownloadStatus,
  progress: number,
  err?: string
) {
  setState((state) => {
    const prev = state.downloads[id]
    const next: DownloadState = {
      id,
      controller: prev.controller,
      status,
      progress,
      error: status === 'error' ? err ?? prev.error ?? '' : undefined,
    }
    return { downloads: { ...state.downloads, [id]: next } }
  })
}

function removeDownload(id: string) {
  setState((state) => {
    const { [id]: _, ...rest } = state.downloads
    return { downloads: rest }
  })
}

export function cancelAllDownloads() {
  const current = getState().downloads
  Object.values(current).forEach((r) => {
    try {
      logger.log('aborting download', r.id)
      r.controller?.abort()
    } catch (e) {
      logger.log('error aborting download', r.id, e)
    }
  })
  useDownloadsStore.setState({ downloads: {} })
}

export type DownloadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

export const [getDownloadCounts, useDownloadCounts] = createGetterAndSelector(
  useDownloadsStore,
  (state): DownloadCounts => {
    const counts: DownloadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
    for (const rec of Object.values(state.downloads)) {
      if (rec.status === 'running') counts.totalActive += 1
      if (rec.status === 'queued') counts.totalQueued += 1
    }
    counts.total = counts.totalActive + counts.totalQueued
    return counts
  }
)

export async function runDownloadWithSlot<T>(params: {
  id: string
  task: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const { id, task } = params
  const controller = registerDownload(id)
  setDownloadState(id, 'queued', 0)
  const release = await acquireDownloadSlot()
  try {
    logger.log('download running', id)
    setDownloadState(id, 'running', 0)
    const result = await task(controller.signal)
    logger.log('download success', id)
    removeDownload(id)
    return result
  } catch (e) {
    logger.log('download error', id, e)
    const message = e instanceof Error ? e.message : String(e)
    setDownloadState(id, 'error', 0, message)
    throw e
  } finally {
    release()
    removeDownload(id)
  }
}

export function updateDownloadProgress(id: string, progress: number) {
  setState((state) => {
    const prev = state.downloads[id]
    if (!prev) return state
    const next: DownloadState = {
      id,
      controller: prev.controller,
      status: prev.status,
      progress,
      error: prev.error,
    }
    return { downloads: { ...state.downloads, [id]: next } }
  })
}

export const [getDownloadState, useDownloadState] = createGetterAndSelector(
  useDownloadsStore,
  (state, id: string): DownloadState | undefined => state.downloads[id]
)
