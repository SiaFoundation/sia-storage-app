import { useSyncExternalStore } from 'react'

export type DownloadStatus = 'downloading' | 'done' | 'error'

export type DownloadState = {
  status: DownloadStatus
  progress: number // 0..1
}

type Snapshot = Record<string, DownloadState>

const store = new Map<string, DownloadState>()
const listeners = new Set<() => void>()
let snapshot: Snapshot = {}

function emit(): void {
  snapshot = Object.fromEntries(store.entries())
  listeners.forEach((l) => l())
}

export function setDownloadState(id: string, next: DownloadState): void {
  store.set(id, next)
  emit()
}

export function updateDownloadProgress(id: string, progress: number): void {
  const prev = store.get(id)
  const status: DownloadStatus = prev?.status ?? 'downloading'
  store.set(id, { status, progress })
  emit()
}

export function clearDownloadState(id: string): void {
  if (store.delete(id)) emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDownloadState(id: string): DownloadState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => snapshot[id],
    () => snapshot[id]
  )
}

export function useAllDownloadStates(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot
  )
}

export function getDownloadState(id: string): DownloadState | undefined {
  return snapshot[id]
}
