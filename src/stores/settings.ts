import {
  setSecureStoreBoolean,
  getSecureStoreBoolean,
  setSecureStoreString,
  getSecureStoreString,
} from './secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'
import { DEFAULT_INDEXER_URL } from '../config'

export const { getKey, triggerChange } = buildSWRHelpers('secureStore')

// Recovery Phrase

export const [getRecoveryPhrase, useRecoveryPhrase] = createGetterAndSWRHook(
  getKey('recoveryPhrase'),
  async () => getSecureStoreString('recoveryPhrase', '')
)

export async function setRecoveryPhrase(
  recoveryPhrase: string
): Promise<boolean> {
  try {
    await setSecureStoreString('recoveryPhrase', recoveryPhrase)
    triggerChange('recoveryPhrase')
    return true
  } catch {
    return false
  }
}

// Indexer

export const [getIndexerURL, useIndexerURL] = createGetterAndSWRHook(
  getKey('indexerURL'),
  () => getSecureStoreString<string>('indexerURL', DEFAULT_INDEXER_URL)
)

export async function setIndexerURL(value: string) {
  await setSecureStoreString('indexerURL', value)
  triggerChange('indexerURL')
}

// Has Onboarded

export const [getHasOnboarded, useHasOnboarded] = createGetterAndSWRHook(
  getKey('hasOnboarded'),
  () => getSecureStoreBoolean('hasOnboarded')
)

export async function setHasOnboarded(value: boolean) {
  await setSecureStoreBoolean('hasOnboarded', value)
  triggerChange('hasOnboarded')
}

// Show Advanced

export async function setShowAdvanced(value: boolean) {
  await setSecureStoreBoolean('showAdvanced', value)
  triggerChange('showAdvanced')
}

export const [getShowAdvanced, useShowAdvanced] = createGetterAndSWRHook(
  getKey('showAdvanced'),
  () => getSecureStoreBoolean('showAdvanced')
)

// Auto Scan Uploads

export const [getAutoScanUploads, useAutoScanUploads] = createGetterAndSWRHook(
  getKey('autoScanUploads'),
  () => getSecureStoreBoolean('autoScanUploads', true)
)

export async function setAutoScanUploads(value: boolean) {
  await setSecureStoreBoolean('autoScanUploads', value)
  triggerChange('autoScanUploads')
}

export async function toggleAutoScanUploads() {
  const current = await getAutoScanUploads()
  const next = !current
  await setAutoScanUploads(next)
}

// Auto Sync Down Events

export const [getAutoSyncDownEvents, useAutoSyncDownEvents] =
  createGetterAndSWRHook(getKey('autoSyncDownEvents'), () =>
    getSecureStoreBoolean('autoSyncDownEvents', true)
  )

export async function setAutoSyncDownEvents(value: boolean) {
  await setSecureStoreBoolean('autoSyncDownEvents', value)
  triggerChange('autoSyncDownEvents')
}

export async function toggleAutoSyncDownEvents() {
  const current = await getAutoSyncDownEvents()
  const next = !current
  await setAutoSyncDownEvents(next)
}

// Library view mode

export type LibraryViewMode = 'gallery' | 'list'

export const [getLibraryViewMode, useLibraryViewMode] = createGetterAndSWRHook(
  getKey('libraryViewMode'),
  () => getSecureStoreString<LibraryViewMode>('libraryViewMode', 'gallery')
)

export async function setLibraryViewMode(value: LibraryViewMode) {
  await setSecureStoreString<LibraryViewMode>('libraryViewMode', value)
  triggerChange('libraryViewMode')
}

export async function toggleLibraryViewMode() {
  const current = await getLibraryViewMode()
  const next = current === 'gallery' ? 'list' : 'gallery'
  await setLibraryViewMode(next)
}
