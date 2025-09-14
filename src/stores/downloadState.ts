import { create } from 'zustand'

export type DownloadStatus = 'downloading' | 'done' | 'error'

export type DownloadState = {
  status: DownloadStatus
  progress: number // 0..1
}

type Snapshot = Record<string, DownloadState>

type DownloadStore = {
  records: Snapshot
  set: (id: string, next: DownloadState) => void
  updateProgress: (id: string, progress: number) => void
  clear: (id: string) => void
}

const useDownloadStore = create<DownloadStore>((set, get) => ({
  records: {},
  set: (id, next) =>
    set((state) => ({ records: { ...state.records, [id]: next } })),
  updateProgress: (id, progress) => {
    const prev = get().records[id]
    const status: DownloadStatus = prev?.status ?? 'downloading'
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

export function setDownloadState(id: string, next: DownloadState): void {
  useDownloadStore.getState().set(id, next)
}

export function updateDownloadProgress(id: string, progress: number): void {
  useDownloadStore.getState().updateProgress(id, progress)
}

export function clearDownloadState(id: string): void {
  useDownloadStore.getState().clear(id)
}

export function useDownloadState(id: string): DownloadState | undefined {
  return useDownloadStore((state) => (id ? state.records[id] : undefined))
}

export function useAllDownloadStates(): Snapshot {
  return useDownloadStore((state) => state.records)
}

export function getDownloadState(id: string): DownloadState | undefined {
  return useDownloadStore.getState().records[id]
}
