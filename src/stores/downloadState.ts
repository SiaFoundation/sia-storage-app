import {
  useTransfersStore,
  setTransferState,
  updateTransferProgress,
  clearTransfer,
  makeTransferKey,
} from './transfers'
import { useShallow } from 'zustand/react/shallow'

export type DownloadStatus = 'downloading' | 'done' | 'error'

export type DownloadState = {
  status: DownloadStatus
  progress: number // 0..1
}

type DownloadMap = Record<string, DownloadState>

function toTransferStatus(
  status: DownloadStatus
): 'running' | 'done' | 'error' {
  return status === 'downloading' ? 'running' : status
}

function fromTransferStatus(
  status: 'running' | 'done' | 'error'
): DownloadStatus {
  return status === 'running' ? 'downloading' : status
}

export function setDownloadState(id: string, next: DownloadState): void {
  setTransferState(id, 'download', toTransferStatus(next.status), next.progress)
}

export function updateDownloadProgress(id: string, progress: number): void {
  updateTransferProgress(id, 'download', progress)
}

export function clearDownloadState(id: string): void {
  clearTransfer(id)
}

export function useDownloadState(id: string): DownloadState | undefined {
  const [status, progress] = useTransfersStore(
    useShallow((state) => {
      const key = id ? makeTransferKey('download', id) : undefined
      const rec = key ? state.inflight[key] : undefined
      return rec && rec.kind === 'download'
        ? ([rec.status, rec.progress] as const)
        : ([undefined, undefined] as const)
    })
  )
  if (typeof status === 'undefined' || typeof progress === 'undefined') {
    return undefined
  }
  return { status: fromTransferStatus(status), progress }
}

export function useAllDownloadStates(): DownloadMap {
  return useTransfersStore((state) => {
    const out: DownloadMap = {}
    for (const [key, rec] of Object.entries(state.inflight)) {
      if (rec.kind !== 'download') continue
      out[rec.id] = {
        status: fromTransferStatus(rec.status),
        progress: rec.progress,
      }
    }
    return out
  })
}

export function getDownloadState(id: string): DownloadState | undefined {
  const key = makeTransferKey('download', id)
  const rec = useTransfersStore.getState().inflight[key]
  if (!rec || rec.kind !== 'download') return undefined
  return { status: fromTransferStatus(rec.status), progress: rec.progress }
}
