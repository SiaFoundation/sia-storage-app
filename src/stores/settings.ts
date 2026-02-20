import { DEFAULT_INDEXER_URL } from '../config'
import { createGetterAndSWRHook } from '../lib/selectors'
import {
  getAsyncStorageBoolean,
  getAsyncStorageString,
  setAsyncStorageBoolean,
  setAsyncStorageString,
} from './asyncStore'

// Active Indexer URL

export const [getIndexerURL, useIndexerURL, indexerURLCache] =
  createGetterAndSWRHook<string>(() =>
    getAsyncStorageString<string>('indexerURL', DEFAULT_INDEXER_URL),
  )

export async function setIndexerURL(value: string) {
  await setAsyncStorageString('indexerURL', value)
  await indexerURLCache.set(value)
}

// Has Onboarded

export const [getHasOnboarded, useHasOnboarded, hasOnboardedCache] =
  createGetterAndSWRHook<boolean>(() => getAsyncStorageBoolean('hasOnboarded'))

export async function setHasOnboarded(value: boolean) {
  await setAsyncStorageBoolean('hasOnboarded', value)
  await hasOnboardedCache.set(value)
}

// Show Advanced

export const [getShowAdvanced, useShowAdvanced, showAdvancedCache] =
  createGetterAndSWRHook<boolean>(() => getAsyncStorageBoolean('showAdvanced'))

export async function setShowAdvanced(value: boolean) {
  await setAsyncStorageBoolean('showAdvanced', value)
  await showAdvancedCache.set(value)
}

// Auto Scan Uploads

export const [getAutoScanUploads, useAutoScanUploads, autoScanUploadsCache] =
  createGetterAndSWRHook<boolean>(() =>
    getAsyncStorageBoolean('autoScanUploads', true),
  )

export async function setAutoScanUploads(value: boolean) {
  await setAsyncStorageBoolean('autoScanUploads', value)
  await autoScanUploadsCache.set(value)
}

export async function toggleAutoScanUploads() {
  const current = await getAutoScanUploads()
  const next = !current
  await setAutoScanUploads(next)
}

// Auto Sync Down Events

export const [
  getAutoSyncDownEvents,
  useAutoSyncDownEvents,
  autoSyncDownEventsCache,
] = createGetterAndSWRHook<boolean>(() =>
  getAsyncStorageBoolean('autoSyncDownEvents', true),
)

export async function setAutoSyncDownEvents(value: boolean) {
  await setAsyncStorageBoolean('autoSyncDownEvents', value)
  await autoSyncDownEventsCache.set(value)
}

export async function toggleAutoSyncDownEvents() {
  const current = await getAutoSyncDownEvents()
  const next = !current
  await setAutoSyncDownEvents(next)
}

// Status display mode (count vs size)

export type StatusDisplayMode = 'count' | 'size'

export const [
  getStatusDisplayMode,
  useStatusDisplayMode,
  statusDisplayModeCache,
] = createGetterAndSWRHook<StatusDisplayMode>(() =>
  getAsyncStorageString<StatusDisplayMode>('statusDisplayMode', 'count'),
)

export async function setStatusDisplayMode(value: StatusDisplayMode) {
  await setAsyncStorageString<StatusDisplayMode>('statusDisplayMode', value)
  await statusDisplayModeCache.set(value)
}

// Photo import directory

export const [
  getPhotoImportDirectory,
  usePhotoImportDirectory,
  photoImportDirectoryCache,
] = createGetterAndSWRHook<string>(() =>
  getAsyncStorageString<string>('photoImportDirectory', ''),
)

export async function setPhotoImportDirectory(value: string) {
  await setAsyncStorageString('photoImportDirectory', value)
  await photoImportDirectoryCache.set(value)
}
