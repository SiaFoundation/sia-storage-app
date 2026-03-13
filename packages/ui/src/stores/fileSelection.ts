import { swrCache } from '@siastorage/core/stores/swr'
import useSWR from 'swr'

type FileSelectionData = {
  isSelectionMode: boolean
  selectedFileIds: string[]
}

const cache = swrCache()

let state: FileSelectionData = {
  isSelectionMode: false,
  selectedFileIds: [],
}

export function enterSelectionMode() {
  state = { ...state, isSelectionMode: true }
  cache.invalidate()
}

export function exitSelectionMode() {
  state = { isSelectionMode: false, selectedFileIds: [] }
  cache.invalidate()
}

export function toggleFileSelection(id: string) {
  const idx = state.selectedFileIds.indexOf(id)
  const next =
    idx >= 0
      ? state.selectedFileIds.filter((x) => x !== id)
      : [...state.selectedFileIds, id]
  state = { ...state, selectedFileIds: next }
  cache.invalidate()
}

export function selectAll(ids: string[]) {
  state = { ...state, selectedFileIds: ids }
  cache.invalidate()
}

export function clearSelection() {
  state = { ...state, selectedFileIds: [] }
  cache.invalidate()
}

const actions = {
  enterSelectionMode,
  exitSelectionMode,
  toggleFileSelection,
  selectAll,
  clearSelection,
}

type FileSelectionFull = FileSelectionData & typeof actions

export function useFileSelectionStore<T>(
  selector: (s: FileSelectionFull) => T,
): T {
  const { data } = useSWR(cache.key(), () => state)
  const current = data ?? state
  return selector({ ...current, ...actions })
}
