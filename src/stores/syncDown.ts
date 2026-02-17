import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'

type SyncDownState = {
  isSyncing: boolean
}

export const useSyncDownStore = create<SyncDownState>(() => ({
  isSyncing: false,
}))

export const { setState: setSyncDownState } = useSyncDownStore

export const [getIsSyncingDown, useIsSyncingDown] = createGetterAndSelector(
  useSyncDownStore,
  (s) => s.isSyncing,
)
