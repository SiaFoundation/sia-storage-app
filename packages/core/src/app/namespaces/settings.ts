import type { StorageAdapter } from '../../adapters/storage'
import { DEFAULT_INDEXER_URL, DEFAULT_MAX_DOWNLOADS } from '../../config'
import type { AppCaches, AppService } from '../service'

/** Builds the settings namespace: typed getters/setters backed by key-value storage. */
export function buildSettingsNamespace(
  storage: StorageAdapter,
  caches: AppCaches,
): AppService['settings'] {
  async function getBool(key: string, defaultValue: boolean): Promise<boolean> {
    const raw = await storage.getItem(key)
    return raw === null ? defaultValue : raw === 'true'
  }
  async function setBool(key: string, value: boolean): Promise<void> {
    await storage.setItem(key, String(value))
    caches.settings.invalidate(key)
  }
  async function getNum(key: string, defaultValue: number): Promise<number> {
    const raw = await storage.getItem(key)
    const n = raw ? Number(raw) : defaultValue
    return Number.isFinite(n) ? n : defaultValue
  }
  async function setNum(key: string, value: number): Promise<void> {
    await storage.setItem(key, String(value))
    caches.settings.invalidate(key)
  }
  async function getStr(key: string, defaultValue: string): Promise<string> {
    const raw = await storage.getItem(key)
    return raw ?? defaultValue
  }
  async function setStr(key: string, value: string): Promise<void> {
    await storage.setItem(key, value)
    caches.settings.invalidate(key)
  }

  return {
    getIndexerURL: () => getStr('indexerURL', DEFAULT_INDEXER_URL),
    setIndexerURL: (v) => setStr('indexerURL', v),
    getHasOnboarded: () => getBool('hasOnboarded', false),
    setHasOnboarded: (v) => setBool('hasOnboarded', v),
    getCompletedResetVersion: () => getStr('completedResetVersion', ''),
    setCompletedResetVersion: (v) => setStr('completedResetVersion', v),
    getShowAdvanced: () => getBool('showAdvanced', false),
    setShowAdvanced: (v) => setBool('showAdvanced', v),
    getAutoScanUploads: () => getBool('autoScanUploads', true),
    setAutoScanUploads: (v) => setBool('autoScanUploads', v),
    getAutoSyncDownEvents: () => getBool('autoSyncDownEvents', true),
    setAutoSyncDownEvents: (v) => setBool('autoSyncDownEvents', v),
    getStatusDisplayMode: () => getStr('statusDisplayMode', 'count'),
    setStatusDisplayMode: (v) => setStr('statusDisplayMode', v),
    getPhotoImportDirectory: () => getStr('photoImportDirectory', 'Media'),
    setPhotoImportDirectory: (v) => setStr('photoImportDirectory', v),
    getActiveLibraryTab: () => getStr('activeLibraryTab', 'files'),
    setActiveLibraryTab: async (v) => {
      caches.settings.set(v, 'activeLibraryTab')
      await storage.setItem('activeLibraryTab', v)
    },
    getMaxDownloads: () => getNum('maxDownloads', DEFAULT_MAX_DOWNLOADS),
    setMaxDownloads: async (v) => {
      const clamped = Math.max(1, Math.floor(Number(v) || 1))
      await storage.setItem('maxDownloads', String(clamped))
      caches.settings.invalidate('maxDownloads')
    },
    getLogLevel: () => getStr('logLevel', 'debug'),
    setLogLevel: (v) => setStr('logLevel', v),
    getLogScopes: async () => {
      const raw = await storage.getItem('logScopes')
      if (!raw) return []
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    },
    setLogScopes: async (v) => {
      await storage.setItem('logScopes', v.join(','))
      caches.settings.invalidate('logScopes')
    },
    getFsEvictionLastRun: () => getNum('fsEvictionLastRun', 0),
    setFsEvictionLastRun: (v) => setNum('fsEvictionLastRun', v),
    getFsOrphanLastRun: () => getNum('fsOrphanLastRun', 0),
    setFsOrphanLastRun: (v) => setNum('fsOrphanLastRun', v),
    getViewSettings: async () => {
      const raw = await storage.getItem('viewSettings')
      if (!raw) return {}
      try {
        return JSON.parse(raw)
      } catch {
        return {}
      }
    },
    setViewSettings: async (v) => {
      await storage.setItem('viewSettings', JSON.stringify(v))
      caches.settings.invalidate('viewSettings')
    },
  }
}
