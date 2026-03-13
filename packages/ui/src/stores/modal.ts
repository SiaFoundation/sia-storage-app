import { swrCache } from '@siastorage/core/stores/swr'
import useSWR from 'swr'

export type DeleteTarget = {
  type: 'file' | 'files' | 'directory' | 'tag'
  ids: string[]
  label: string
}

type ModalData = {
  manageTagsFileId: string | null
  moveToDirectoryFileIds: string[] | null
  renameFile: { id: string; name: string } | null
  deleteTarget: DeleteTarget | null
  statusOpen: boolean
  recording: 'screen' | 'audio' | null
  createDirectoryOpen: boolean
  createTagOpen: boolean
  contextMenu: {
    fileId: string
    position: { x: number; y: number }
    isFavorite: boolean
  } | null
}

const cache = swrCache()

let state: ModalData = {
  manageTagsFileId: null,
  moveToDirectoryFileIds: null,
  renameFile: null,
  deleteTarget: null,
  statusOpen: false,
  recording: null,
  createDirectoryOpen: false,
  createTagOpen: false,
  contextMenu: null,
}

export function openManageTags(fileId: string) {
  state = { ...state, manageTagsFileId: fileId }
  cache.invalidate()
}
export function closeManageTags() {
  state = { ...state, manageTagsFileId: null }
  cache.invalidate()
}
export function openMoveToDirectory(fileIds: string[]) {
  state = { ...state, moveToDirectoryFileIds: fileIds }
  cache.invalidate()
}
export function closeMoveToDirectory() {
  state = { ...state, moveToDirectoryFileIds: null }
  cache.invalidate()
}
export function openRename(id: string, name: string) {
  state = { ...state, renameFile: { id, name } }
  cache.invalidate()
}
export function closeRename() {
  state = { ...state, renameFile: null }
  cache.invalidate()
}
export function openDelete(target: DeleteTarget) {
  state = { ...state, deleteTarget: target }
  cache.invalidate()
}
export function closeDelete() {
  state = { ...state, deleteTarget: null }
  cache.invalidate()
}
export function openStatus() {
  state = { ...state, statusOpen: true }
  cache.invalidate()
}
export function closeStatus() {
  state = { ...state, statusOpen: false }
  cache.invalidate()
}
export function openRecording(type: 'screen' | 'audio') {
  state = { ...state, recording: type }
  cache.invalidate()
}
export function closeRecording() {
  state = { ...state, recording: null }
  cache.invalidate()
}
export function openCreateDirectory() {
  state = { ...state, createDirectoryOpen: true }
  cache.invalidate()
}
export function closeCreateDirectory() {
  state = { ...state, createDirectoryOpen: false }
  cache.invalidate()
}
export function openCreateTag() {
  state = { ...state, createTagOpen: true }
  cache.invalidate()
}
export function closeCreateTag() {
  state = { ...state, createTagOpen: false }
  cache.invalidate()
}
export function openContextMenu(
  fileId: string,
  position: { x: number; y: number },
  isFavorite: boolean,
) {
  state = { ...state, contextMenu: { fileId, position, isFavorite } }
  cache.invalidate()
}
export function closeContextMenu() {
  state = { ...state, contextMenu: null }
  cache.invalidate()
}

const actions = {
  openManageTags,
  closeManageTags,
  openMoveToDirectory,
  closeMoveToDirectory,
  openRename,
  closeRename,
  openDelete,
  closeDelete,
  openStatus,
  closeStatus,
  openRecording,
  closeRecording,
  openCreateDirectory,
  closeCreateDirectory,
  openCreateTag,
  closeCreateTag,
  openContextMenu,
  closeContextMenu,
}

type ModalActions = typeof actions
type ModalFull = ModalData & ModalActions

export function useModalStore<T>(selector: (s: ModalFull) => T): T {
  const { data } = useSWR(cache.key(), () => state)
  const current = data ?? state
  return selector({ ...current, ...actions })
}
