import { useSyncExternalStore } from 'react'

export type UploadRuntimeStatus = 'uploading' | 'done' | 'error'

export type UploadRuntimeState = {
  status: UploadRuntimeStatus
  progress: number // 0..1
}

type Snapshot = Record<string, UploadRuntimeState>

const store = new Map<string, UploadRuntimeState>()
const listeners = new Set<() => void>()
let snapshot: Snapshot = {}

function emit(): void {
  snapshot = Object.fromEntries(store.entries())
  listeners.forEach((l) => l())
}

export function setUploadState(id: string, next: UploadRuntimeState): void {
  store.set(id, next)
  emit()
}

export function updateUploadProgress(id: string, progress: number): void {
  const prev = store.get(id)
  const status: UploadRuntimeStatus = prev?.status ?? 'uploading'
  store.set(id, { status, progress })
  emit()
}

export function clearUploadState(id: string): void {
  if (store.delete(id)) emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUploadState(id: string): UploadRuntimeState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => snapshot[id],
    () => snapshot[id]
  )
}

export function useAllUploadStates(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot
  )
}
