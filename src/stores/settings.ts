import { DEFAULT_INDEXER_URL } from '../config'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'
import {
  getAsyncStorageBoolean,
  getAsyncStorageString,
  setAsyncStorageBoolean,
  setAsyncStorageString,
} from './asyncStore'

export const settingsSwr = buildSWRHelpers('settings')

// Active Indexer URL

export const [getIndexerURL, useIndexerURL] = createGetterAndSWRHook(
  settingsSwr.getKey('indexerURL'),
  () => getAsyncStorageString<string>('indexerURL', DEFAULT_INDEXER_URL),
)

export async function setIndexerURL(value: string) {
  await setAsyncStorageString('indexerURL', value)
  settingsSwr.triggerChange('indexerURL')
}

// Has Onboarded

export const [getHasOnboarded, useHasOnboarded] = createGetterAndSWRHook(
  settingsSwr.getKey('hasOnboarded'),
  () => getAsyncStorageBoolean('hasOnboarded'),
)

export async function setHasOnboarded(value: boolean) {
  await setAsyncStorageBoolean('hasOnboarded', value)
  settingsSwr.triggerChange('hasOnboarded')
}

// Show Advanced

export async function setShowAdvanced(value: boolean) {
  await setAsyncStorageBoolean('showAdvanced', value)
  settingsSwr.triggerChange('showAdvanced')
}

export const [getShowAdvanced, useShowAdvanced] = createGetterAndSWRHook(
  settingsSwr.getKey('showAdvanced'),
  () => getAsyncStorageBoolean('showAdvanced'),
)

// Auto Scan Uploads

export const [getAutoScanUploads, useAutoScanUploads] = createGetterAndSWRHook(
  settingsSwr.getKey('autoScanUploads'),
  () => getAsyncStorageBoolean('autoScanUploads', true),
)

export async function setAutoScanUploads(value: boolean) {
  await setAsyncStorageBoolean('autoScanUploads', value)
  settingsSwr.triggerChange('autoScanUploads')
}

export async function toggleAutoScanUploads() {
  const current = await getAutoScanUploads()
  const next = !current
  await setAutoScanUploads(next)
}

// Auto Sync Down Events

export const [getAutoSyncDownEvents, useAutoSyncDownEvents] =
  createGetterAndSWRHook(settingsSwr.getKey('autoSyncDownEvents'), () =>
    getAsyncStorageBoolean('autoSyncDownEvents', true),
  )

export async function setAutoSyncDownEvents(value: boolean) {
  await setAsyncStorageBoolean('autoSyncDownEvents', value)
  settingsSwr.triggerChange('autoSyncDownEvents')
}

export async function toggleAutoSyncDownEvents() {
  const current = await getAutoSyncDownEvents()
  const next = !current
  await setAutoSyncDownEvents(next)
}

// Library view mode

export type LibraryViewMode = 'gallery' | 'list'

export const [getLibraryViewMode, useLibraryViewMode] = createGetterAndSWRHook(
  settingsSwr.getKey('libraryViewMode'),
  () => getAsyncStorageString<LibraryViewMode>('libraryViewMode', 'gallery'),
)

export async function setLibraryViewMode(value: LibraryViewMode) {
  await setAsyncStorageString<LibraryViewMode>('libraryViewMode', value)
  settingsSwr.triggerChange('libraryViewMode')
}

export async function toggleLibraryViewMode() {
  const current = await getLibraryViewMode()
  const next = current === 'gallery' ? 'list' : 'gallery'
  await setLibraryViewMode(next)
}

// Status display mode (count vs size)

export type StatusDisplayMode = 'count' | 'size'

export const [getStatusDisplayMode, useStatusDisplayMode] =
  createGetterAndSWRHook(settingsSwr.getKey('statusDisplayMode'), () =>
    getAsyncStorageString<StatusDisplayMode>('statusDisplayMode', 'count'),
  )

export async function setStatusDisplayMode(value: StatusDisplayMode) {
  await setAsyncStorageString<StatusDisplayMode>('statusDisplayMode', value)
  settingsSwr.triggerChange('statusDisplayMode')
}
