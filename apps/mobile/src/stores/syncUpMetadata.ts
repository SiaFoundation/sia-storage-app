import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'

type SyncUpMetadataState = {
  isSyncing: boolean
  processed: number
  total: number
}

export const useSyncUpMetadataStore = create<SyncUpMetadataState>(() => ({
  isSyncing: false,
  processed: 0,
  total: 0,
}))

export const { setState: setSyncUpMetadataState } = useSyncUpMetadataStore

export const [getIsSyncingUpMetadata, useIsSyncingUpMetadata] =
  createGetterAndSelector(useSyncUpMetadataStore, (s) => s.isSyncing)

export const [getSyncUpMetadataProgress, useSyncUpMetadataProgress] =
  createGetterAndSelector(useSyncUpMetadataStore, (s) => ({
    processed: s.processed,
    total: s.total,
  }))
