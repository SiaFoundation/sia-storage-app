import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../lib/logger'
import { acquireTransfersSlot } from '../managers/transfersPool'
import { createGetterAndSelector } from '../lib/selectors'

export type TransferKind = 'upload' | 'download'

export type TransferStatus = 'queued' | 'running' | 'done' | 'error'

export type TransferState = {
  id: string
  kind: TransferKind
  controller?: AbortController
  status: TransferStatus
  progress: number
  error?: string
}

type TransfersStore = {
  transfers: Record<string, TransferState>
  add: (record: Omit<TransferState, 'status' | 'progress'>) => void
  updateState: (
    id: string,
    kind: TransferKind,
    status: TransferStatus,
    progress: number,
    error?: string
  ) => void
  updateProgress: (id: string, kind: TransferKind, progress: number) => void
  remove: (id: string, kind: TransferKind) => void
  cancelAll: () => void
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  transfers: {},
  add: (record) =>
    set((state) => {
      const key = makeTransferKey(record.kind, record.id)
      const prev = state.transfers[key]
      const next: TransferState = {
        id: record.id,
        kind: record.kind,
        controller: record.controller ?? prev?.controller,
        status: prev?.status ?? 'queued',
        progress: prev?.progress ?? 0,
      }
      return { transfers: { ...state.transfers, [key]: next } }
    }),
  updateState: (id, kind, status, progress, err) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.transfers[key]
      const next: TransferState = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status,
        progress,
        error: status === 'error' ? err ?? prev?.error ?? '' : undefined,
      }
      return { transfers: { ...state.transfers, [key]: next } }
    }),
  updateProgress: (id, kind, progress) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.transfers[key]
      const next: TransferState = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status: prev?.status ?? 'queued',
        progress,
        error: prev?.error,
      }
      return { transfers: { ...state.transfers, [key]: next } }
    }),
  remove: (id, kind) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const { [key]: _, ...rest } = state.transfers
      return { transfers: rest }
    }),
  cancelAll: () => {
    const current = get().transfers
    Object.values(current).forEach((r) => {
      try {
        logger.log('aborting transfer', r.id)
        r.controller?.abort()
      } catch (e) {
        logger.log('error aborting transfer', r.id, e)
        // Ignore.
      }
    })
    set({ transfers: {} })
  },
}))

function registerTransfer(id: string, kind: TransferKind): AbortController {
  const controller = new AbortController()
  useTransfersStore.getState().add({ id, kind, controller })
  return controller
}

export function cancelAllTransfers() {
  return useTransfersStore.getState().cancelAll()
}

function setTransferState(
  id: string,
  kind: TransferKind,
  status: TransferStatus,
  progress: number,
  error?: string
) {
  return useTransfersStore
    .getState()
    .updateState(id, kind, status, progress, error)
}

function updateTransferProgress(
  id: string,
  kind: TransferKind,
  progress: number
) {
  return useTransfersStore.getState().updateProgress(id, kind, progress)
}

export type TransferCounts = {
  total: number
  totalActive: number
  totalQueued: number
  uploads: number
  uploadsActive: number
  uploadsQueued: number
  downloads: number
  downloadsActive: number
  downloadsQueued: number
}

export const [getTransferCounts, useTransferCounts] = createGetterAndSelector(
  useTransfersStore,
  (state): TransferCounts => {
    const counts: TransferCounts = {
      total: 0,
      totalActive: 0,
      totalQueued: 0,
      uploads: 0,
      uploadsActive: 0,
      uploadsQueued: 0,
      downloads: 0,
      downloadsActive: 0,
      downloadsQueued: 0,
    }
    for (const rec of Object.values(state.transfers)) {
      const bucket = rec.kind === 'upload' ? 'uploads' : 'downloads'
      if (rec.status === 'running') {
        counts.totalActive += 1
        if (bucket === 'uploads') {
          counts.uploadsActive += 1
        } else {
          counts.downloadsActive += 1
        }
      } else if (rec.status === 'queued') {
        counts.totalQueued += 1
        if (bucket === 'uploads') {
          counts.uploadsQueued += 1
        } else {
          counts.downloadsQueued += 1
        }
      }
    }
    counts.total = counts.totalActive + counts.totalQueued
    counts.uploads = counts.uploadsActive + counts.uploadsQueued
    counts.downloads = counts.downloadsActive + counts.downloadsQueued
    return counts
  }
)

export function makeTransferKey(kind: TransferKind, id: string): string {
  return `${kind}:${id}`
}

export const [getActiveUploads, useActiveUploads] = createGetterAndSelector(
  useTransfersStore,
  (state): TransferState[] => {
    return Object.values(state.transfers).filter((rec) => rec.kind === 'upload')
  }
)

export const [getActiveUploadCount, useActiveUploadCount] =
  createGetterAndSelector(
    useTransfersStore,
    (): number => getActiveUploads().length
  )

export const [getHasActiveUploads, useHasActiveUploads] =
  createGetterAndSelector(
    useTransfersStore,
    (): boolean => getActiveUploads().length > 0
  )

export async function runTransferWithSlot<T>(params: {
  id: string
  kind: TransferKind
  task: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const { id, kind, task } = params
  const controller = registerTransfer(id, kind)
  setTransferState(id, kind, 'queued', 0)
  const release = await acquireTransfersSlot()
  try {
    logger.log('transfer running', id, kind)
    setTransferState(id, kind, 'running', 0)
    const result = await task(controller.signal)
    logger.log('transfer success', id, kind)
    useTransfersStore.getState().remove(id, kind)
    return result
  } catch (e) {
    logger.log('transfer error', id, kind, e)
    const message = e instanceof Error ? e.message : String(e)
    setTransferState(id, kind, 'error', 0, message)
    throw e
  } finally {
    release()
    useTransfersStore.getState().remove(id, kind)
  }
}

export function updateUploadProgress(id: string, progress: number) {
  return updateTransferProgress(id, 'upload', progress)
}

export function useUploadState(id: string): TransferState | undefined {
  const key = id ? makeTransferKey('upload', id) : undefined
  return useTransfersStore(
    useShallow((state) => (key ? state.transfers[key] : undefined))
  )
}

export function updateDownloadProgress(id: string, progress: number) {
  return updateTransferProgress(id, 'download', progress)
}

export function useDownloadState(id: string): TransferState | undefined {
  const key = id ? makeTransferKey('download', id) : undefined
  return useTransfersStore(
    useShallow((state) => (key ? state.transfers[key] : undefined))
  )
}
