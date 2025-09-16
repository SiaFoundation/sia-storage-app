import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../lib/logger'
import { getGlobalSlotPool } from '../managers/slotPool'

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
  inflight: Record<string, TransferState>
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
  inflight: {},
  add: (record) =>
    set((state) => {
      const key = makeTransferKey(record.kind, record.id)
      const prev = state.inflight[key]
      const next: TransferState = {
        id: record.id,
        kind: record.kind,
        controller: record.controller ?? prev?.controller,
        status: prev?.status ?? 'running',
        progress: prev?.progress ?? 0,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  updateState: (id, kind, status, progress, err) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.inflight[key]
      const next: TransferState = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status,
        progress,
        error: status === 'error' ? err ?? prev?.error ?? '' : undefined,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  updateProgress: (id, kind, progress) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.inflight[key]
      const next: TransferState = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status: prev?.status ?? 'queued',
        progress,
        error: prev?.error,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  remove: (id, kind) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const { [key]: _, ...rest } = state.inflight
      return { inflight: rest }
    }),
  cancelAll: () => {
    const current = get().inflight
    Object.values(current).forEach((r) => {
      try {
        logger.log('aborting transfer', r.id)
        r.controller?.abort()
      } catch (e) {
        logger.log('error aborting transfer', r.id, e)
        // Ignore.
      }
    })
    set({ inflight: {} })
  },
}))

export function registerTransfer(
  id: string,
  kind: TransferKind
): AbortController {
  const controller = new AbortController()
  useTransfersStore.getState().add({ id, kind, controller })
  return controller
}

export function unregisterTransfer(id: string): void {
  // Detach controller but keep record (for error state visibility).
  useTransfersStore.setState((state) => {
    const entries = Object.entries(state.inflight)
    const next: Record<string, TransferState> = {}
    for (const [k, v] of entries) {
      if (v.id === id) next[k] = { ...v, controller: undefined }
      else next[k] = v
    }
    return { inflight: next }
  })
}

export function cancelAllTransfers() {
  return useTransfersStore.getState().cancelAll()
}

export function setTransferState(
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

export function updateTransferProgress(
  id: string,
  kind: TransferKind,
  progress: number
) {
  return useTransfersStore.getState().updateProgress(id, kind, progress)
}

export function useInflightCounts(): {
  uploads: number
  downloads: number
  total: number
} {
  return useTransfersStore(
    useShallow((state) => {
      let uploads = 0
      let downloads = 0
      for (const rec of Object.values(state.inflight)) {
        if (rec.kind === 'upload') uploads += 1
        else if (rec.kind === 'download') downloads += 1
      }
      return { uploads, downloads, total: uploads + downloads }
    })
  )
}

export function makeTransferKey(kind: TransferKind, id: string): string {
  return `${kind}:${id}`
}

export async function runTransferWithSlot<T>(params: {
  id: string
  kind: TransferKind
  task: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const { id, kind, task } = params
  const controller = registerTransfer(id, kind)
  setTransferState(id, kind, 'queued', 0)
  const release = await getGlobalSlotPool().acquire()
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

export function setUploadState(id: string, next: TransferState) {
  return setTransferState(id, 'upload', next.status, next.progress)
}

export function updateUploadProgress(id: string, progress: number) {
  return updateTransferProgress(id, 'upload', progress)
}

export function useUploadState(id: string): TransferState | undefined {
  const key = id ? makeTransferKey('upload', id) : undefined
  return useTransfersStore(
    useShallow((state) => (key ? state.inflight[key] : undefined))
  )
}

export function setDownloadState(id: string, next: TransferState) {
  return setTransferState(id, 'download', next.status, next.progress)
}

export function updateDownloadProgress(id: string, progress: number) {
  return updateTransferProgress(id, 'download', progress)
}

export function useDownloadState(id: string): TransferState | undefined {
  const key = id ? makeTransferKey('download', id) : undefined
  return useTransfersStore(
    useShallow((state) => (key ? state.inflight[key] : undefined))
  )
}
