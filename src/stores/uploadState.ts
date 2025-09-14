import {
  useTransfersStore,
  setTransferState,
  updateTransferProgress,
  clearTransfer,
  makeTransferKey,
} from './transfers'
import { useShallow } from 'zustand/react/shallow'

export type UploadStatus = 'uploading' | 'done' | 'error'

export type UploadState = {
  status: UploadStatus
  progress: number // 0..1
}

type UploadMap = Record<string, UploadState>

function toTransferStatus(status: UploadStatus): 'running' | 'done' | 'error' {
  return status === 'uploading' ? 'running' : status
}

function fromTransferStatus(
  status: 'running' | 'done' | 'error'
): UploadStatus {
  return status === 'running' ? 'uploading' : status
}

export function setUploadState(id: string, next: UploadState): void {
  setTransferState(id, 'upload', toTransferStatus(next.status), next.progress)
}

export function updateUploadProgress(id: string, progress: number): void {
  updateTransferProgress(id, 'upload', progress)
}

export function clearUploadState(id: string): void {
  clearTransfer(id)
}

export function useUploadState(id: string): UploadState | undefined {
  const [status, progress] = useTransfersStore(
    useShallow((state) => {
      const key = id ? makeTransferKey('upload', id) : undefined
      const rec = key ? state.inflight[key] : undefined
      return rec && rec.kind === 'upload'
        ? ([rec.status, rec.progress] as const)
        : ([undefined, undefined] as const)
    })
  )
  if (typeof status === 'undefined' || typeof progress === 'undefined') {
    return undefined
  }
  return { status: fromTransferStatus(status), progress }
}

export function useAllUploadStates(): UploadMap {
  return useTransfersStore((state) => {
    const out: UploadMap = {}
    for (const [key, rec] of Object.entries(state.inflight)) {
      if (rec.kind !== 'upload') continue
      out[rec.id] = {
        status: fromTransferStatus(rec.status),
        progress: rec.progress,
      }
    }
    return out
  })
}

export function getUploadState(id: string): UploadState | undefined {
  const key = makeTransferKey('upload', id)
  const rec = useTransfersStore.getState().inflight[key]
  if (!rec || rec.kind !== 'upload') return undefined
  return { status: fromTransferStatus(rec.status), progress: rec.progress }
}
