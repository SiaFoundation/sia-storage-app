import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../lib/logger'

export type TransferKind = 'upload' | 'download'

export type TransferStatus = 'running' | 'done' | 'error'

export type TransferRecord = {
  id: string
  kind: TransferKind
  controller?: AbortController
  status: TransferStatus
  progress: number
}

type TransfersStore = {
  inflight: Record<string, TransferRecord>
  add: (record: Omit<TransferRecord, 'status' | 'progress'>) => void
  updateState: (
    id: string,
    kind: TransferKind,
    status: TransferStatus,
    progress: number
  ) => void
  updateProgress: (id: string, kind: TransferKind, progress: number) => void
  remove: (id: string) => void
  cancelAll: () => void
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  inflight: {},
  add: (record) =>
    set((state) => {
      const key = makeTransferKey(record.kind, record.id)
      const prev = state.inflight[key]
      const next: TransferRecord = {
        id: record.id,
        kind: record.kind,
        controller: record.controller ?? prev?.controller,
        status: prev?.status ?? 'running',
        progress: prev?.progress ?? 0,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  updateState: (id, kind, status, progress) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.inflight[key]
      const next: TransferRecord = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status,
        progress,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  updateProgress: (id, kind, progress) =>
    set((state) => {
      const key = makeTransferKey(kind, id)
      const prev = state.inflight[key]
      const next: TransferRecord = {
        id,
        kind: kind ?? prev?.kind ?? 'upload',
        controller: prev?.controller,
        status: prev?.status ?? 'running',
        progress,
      }
      return { inflight: { ...state.inflight, [key]: next } }
    }),
  remove: (id) =>
    set((state) => {
      const entries = Object.entries(state.inflight)
      let removed: TransferRecord | undefined
      const rest: Record<string, TransferRecord> = {}
      for (const [k, v] of entries) {
        if (!removed && v.id === id) {
          removed = v
          continue
        }
        rest[k] = v
      }
      if (removed) {
        // No action on remove other than dropping reference.
      }
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
  useTransfersStore.getState().remove(id)
}

export function cancelAllTransfers(): void {
  useTransfersStore.getState().cancelAll()
}

export function setTransferState(
  id: string,
  kind: TransferKind,
  status: TransferStatus,
  progress: number
): void {
  useTransfersStore.getState().updateState(id, kind, status, progress)
}

export function updateTransferProgress(
  id: string,
  kind: TransferKind,
  progress: number
): void {
  useTransfersStore.getState().updateProgress(id, kind, progress)
}

export function clearTransfer(id: string): void {
  useTransfersStore.getState().remove(id)
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
