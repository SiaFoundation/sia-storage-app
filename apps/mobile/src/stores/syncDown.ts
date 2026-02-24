import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'

type SyncDownState = {
  isSyncing: boolean
  added: number
  existing: number
  deleted: number
  cursorAt: number | null
}

export const useSyncDownStore = create<SyncDownState>(() => ({
  isSyncing: false,
  added: 0,
  existing: 0,
  deleted: 0,
  cursorAt: null,
}))

export const { setState: setSyncDownState } = useSyncDownStore

export const [getIsSyncingDown, useIsSyncingDown] = createGetterAndSelector(
  useSyncDownStore,
  (s) => s.isSyncing,
)

export const [getSyncDownProgress, useSyncDownProgress] =
  createGetterAndSelector(useSyncDownStore, (s) => ({
    added: s.added,
    existing: s.existing,
    deleted: s.deleted,
    cursorAt: s.cursorAt,
  }))
