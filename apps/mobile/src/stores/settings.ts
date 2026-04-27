import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import useSWR from 'swr'
import { app } from './appService'

export type ActiveLibraryTab = 'files' | 'tags' | 'media'

export function useActiveLibraryTab() {
  return useSWR(
    app().caches.settings.key('activeLibraryTab'),
    () => app().settings.getActiveLibraryTab() as Promise<ActiveLibraryTab>,
  )
}

export async function toggleAutoScanUploads() {
  const current = await app().settings.getAutoScanUploads()
  await app().settings.setAutoScanUploads(!current)
}

export async function toggleAutoSyncDownEvents() {
  const current = await app().settings.getAutoSyncDownEvents()
  await app().settings.setAutoSyncDownEvents(!current)
}

// Keep Awake (platform-specific: uses expo-keep-awake)

const KEEP_AWAKE_TAG = 'sync'

export async function getKeepAwake(): Promise<boolean> {
  const raw = await app().storage.getItem('keepAwake')
  return raw === null ? false : raw === 'true'
}

export function useKeepAwake() {
  return useSWR(app().caches.settings.key('keepAwake'), () => getKeepAwake())
}

export async function setKeepAwake(value: boolean) {
  await app().storage.setItem('keepAwake', String(value))
  app().caches.settings.invalidate('keepAwake')
  if (value) {
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG)
  } else {
    deactivateKeepAwake(KEEP_AWAKE_TAG)
  }
}

export async function toggleKeepAwake() {
  const current = await getKeepAwake()
  await setKeepAwake(!current)
}

export async function initKeepAwake() {
  const enabled = await getKeepAwake()
  if (enabled) {
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG)
  }
}

// Developer preference exposing SQLite WAL journal mode as a toggle so we can
// test it in the field. Default off. The toggle goes away once a feature
// requires WAL. Read at bootstrap and applied to the DB module before
// initializeDB runs.

export async function getUseWalMode(): Promise<boolean> {
  const raw = await app().storage.getItem('devUseWalMode')
  return raw === 'true'
}

export function useUseWalMode() {
  return useSWR(app().caches.settings.key('devUseWalMode'), () => getUseWalMode())
}

export async function setUseWalMode(value: boolean) {
  await app().storage.setItem('devUseWalMode', String(value))
  app().caches.settings.invalidate('devUseWalMode')
}

export async function toggleUseWalMode() {
  const current = await getUseWalMode()
  await setUseWalMode(!current)
}
