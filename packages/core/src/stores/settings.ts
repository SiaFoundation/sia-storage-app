import useSWR from 'swr'
import { useApp } from '../app/context'

/** Returns the configured indexer URL used for metadata sync. */
export function useIndexerURL() {
  const app = useApp()
  return useSWR(app.caches.settings.key('indexerURL'), () => app.settings.getIndexerURL())
}

/** Returns whether the user has completed the onboarding flow. */
export function useHasOnboarded() {
  const app = useApp()
  return useSWR(app.caches.settings.key('hasOnboarded'), () => app.settings.getHasOnboarded())
}

/** Returns whether the advanced settings UI is enabled. */
export function useShowAdvanced() {
  const app = useApp()
  return useSWR(app.caches.settings.key('showAdvanced'), () => app.settings.getShowAdvanced())
}

/** Returns whether automatic scanning of uploads is enabled. */
export function useAutoScanUploads() {
  const app = useApp()
  return useSWR(app.caches.settings.key('autoScanUploads'), () => app.settings.getAutoScanUploads())
}

/** Returns whether automatic syncing of download events is enabled. */
export function useAutoSyncDownEvents() {
  const app = useApp()
  return useSWR(app.caches.settings.key('autoSyncDownEvents'), () =>
    app.settings.getAutoSyncDownEvents(),
  )
}

/** Returns the current status bar display mode preference. */
export function useStatusDisplayMode() {
  const app = useApp()
  return useSWR(app.caches.settings.key('statusDisplayMode'), () =>
    app.settings.getStatusDisplayMode(),
  )
}

/** Returns the directory path configured for photo imports. */
export function usePhotoImportDirectory() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photoImportDirectory'), () =>
    app.settings.getPhotoImportDirectory(),
  )
}

/** Returns the currently selected tab in the library view. */
export function useActiveLibraryTab() {
  const app = useApp()
  return useSWR(app.caches.settings.key('activeLibraryTab'), () =>
    app.settings.getActiveLibraryTab(),
  )
}

/** Returns the maximum number of concurrent downloads allowed. */
export function useMaxDownloads() {
  const app = useApp()
  return useSWR(app.caches.settings.key('maxDownloads'), () => app.settings.getMaxDownloads())
}

/** Returns the current log level setting. */
export function useLogLevel() {
  const app = useApp()
  return useSWR(app.caches.settings.key('logLevel'), () => app.settings.getLogLevel())
}

/** Returns the set of enabled log scopes for filtered logging. */
export function useLogScopes() {
  const app = useApp()
  return useSWR(app.caches.settings.key('logScopes'), () => app.settings.getLogScopes())
}

/** Returns whether remote log forwarding is enabled. */
export function useRemoteLogEnabled() {
  const app = useApp()
  return useSWR(app.caches.settings.key('remoteLogEnabled'), () =>
    app.settings.getRemoteLogEnabled(),
  )
}

/** Returns the configured remote log endpoint URL. */
export function useRemoteLogEndpoint() {
  const app = useApp()
  return useSWR(app.caches.settings.key('remoteLogEndpoint'), () =>
    app.settings.getRemoteLogEndpoint(),
  )
}
