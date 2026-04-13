import { swrState } from '@siastorage/core/stores'

type SelectionState = {
  isSelectionMode: boolean
  selectedIds: string[]
}

const store = swrState<SelectionState>({
  isSelectionMode: false,
  selectedIds: [],
})

function selectedSet(): Set<string> {
  return new Set(store.getState().selectedIds)
}

export function enterSelectionMode(): void {
  store.setState({ ...store.getState(), isSelectionMode: true })
}

export function exitSelectionMode(): void {
  store.setState({ isSelectionMode: false, selectedIds: [] })
}

export function toggleFileSelection(id: string): void {
  const s = store.getState()
  const set = selectedSet()
  if (set.has(id)) set.delete(id)
  else set.add(id)
  store.setState({ ...s, selectedIds: [...set] })
}

export function selectFile(id: string): void {
  const s = store.getState()
  const set = selectedSet()
  set.add(id)
  store.setState({ ...s, selectedIds: [...set] })
}

export function selectFiles(ids: string[]): void {
  const s = store.getState()
  const set = selectedSet()
  for (const id of ids) set.add(id)
  store.setState({ ...s, selectedIds: [...set] })
}

export function deselectFile(id: string): void {
  const s = store.getState()
  const set = selectedSet()
  set.delete(id)
  store.setState({ ...s, selectedIds: [...set] })
}

export function clearSelection(): void {
  store.setState({ ...store.getState(), selectedIds: [] })
}

export function resetFileSelection(): void {
  store.setState({ isSelectionMode: false, selectedIds: [] })
}

export function getSelectedFileIds(): string[] {
  return store.getState().selectedIds
}

export function getIsSelectionMode(): boolean {
  return store.getState().isSelectionMode
}

export function useIsSelectionMode(): boolean {
  return store.useValue((s) => s.isSelectionMode, 'mode')
}

export function useSelectedFileIds(): string[] {
  return store.useValue((s) => s.selectedIds, 'ids')
}

export function useIsFileSelected(id: string): boolean {
  return store.useValue((s) => s.selectedIds.includes(id), 'selected', id)
}

export function useSelectedCount(): number {
  return store.useValue((s) => s.selectedIds.length, 'count')
}
