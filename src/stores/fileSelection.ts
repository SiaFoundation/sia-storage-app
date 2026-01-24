import { create } from 'zustand'

type FileSelectionState = {
  selectedFileIds: Set<string>
  isSelectionMode: boolean
}

export const useFileSelectionStore = create<FileSelectionState>(() => ({
  selectedFileIds: new Set(),
  isSelectionMode: false,
}))

const { setState, getState } = useFileSelectionStore

export function enterSelectionMode(): void {
  setState({ isSelectionMode: true })
}

export function exitSelectionMode(): void {
  setState({ isSelectionMode: false, selectedFileIds: new Set() })
}

export function toggleFileSelection(id: string): void {
  setState((state) => {
    const next = new Set(state.selectedFileIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    return { selectedFileIds: next }
  })
}

export function selectFile(id: string): void {
  setState((state) => {
    const next = new Set(state.selectedFileIds)
    next.add(id)
    return { selectedFileIds: next }
  })
}

export function selectFiles(ids: string[]): void {
  setState((state) => {
    const next = new Set(state.selectedFileIds)
    ids.forEach((id) => next.add(id))
    return { selectedFileIds: next }
  })
}

export function deselectFile(id: string): void {
  setState((state) => {
    const next = new Set(state.selectedFileIds)
    next.delete(id)
    return { selectedFileIds: next }
  })
}

export function clearSelection(): void {
  setState({ selectedFileIds: new Set() })
}

export function getSelectedFileIds(): Set<string> {
  return getState().selectedFileIds
}

export function getIsSelectionMode(): boolean {
  return getState().isSelectionMode
}

export function useIsSelectionMode(): boolean {
  return useFileSelectionStore((s) => s.isSelectionMode)
}

export function useSelectedFileIds(): Set<string> {
  return useFileSelectionStore((s) => s.selectedFileIds)
}

export function useIsFileSelected(id: string): boolean {
  return useFileSelectionStore((s) => s.selectedFileIds.has(id))
}

export function useSelectedCount(): number {
  return useFileSelectionStore((s) => s.selectedFileIds.size)
}
