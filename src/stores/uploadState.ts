import { create } from 'zustand'

export type UploadStatus = 'uploading' | 'done' | 'error'

export type UploadState = {
  status: UploadStatus
  progress: number // 0..1
}

type Snapshot = Record<string, UploadState>

type UploadStore = {
  records: Snapshot
  set: (id: string, next: UploadState) => void
  updateProgress: (id: string, progress: number) => void
  clear: (id: string) => void
}

const useUploadStore = create<UploadStore>((set, get) => ({
  records: {},
  set: (id, next) =>
    set((state) => ({ records: { ...state.records, [id]: next } })),
  updateProgress: (id, progress) => {
    const prev = get().records[id]
    const status: UploadStatus = prev?.status ?? 'uploading'
    set((state) => ({
      records: { ...state.records, [id]: { status, progress } },
    }))
  },
  clear: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.records
      return { records: rest }
    }),
}))

export function setUploadState(id: string, next: UploadState): void {
  useUploadStore.getState().set(id, next)
}

export function updateUploadProgress(id: string, progress: number): void {
  useUploadStore.getState().updateProgress(id, progress)
}

export function clearUploadState(id: string): void {
  useUploadStore.getState().clear(id)
}

export function useUploadState(id: string): UploadState | undefined {
  return useUploadStore((state) => (id ? state.records[id] : undefined))
}

export function useAllUploadStates(): Snapshot {
  return useUploadStore((state) => state.records)
}

export function getUploadState(id: string): UploadState | undefined {
  return useUploadStore.getState().records[id]
}
