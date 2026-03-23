import Constants from 'expo-constants'
// biome-ignore lint/style/noRestrictedImports: Paths.appleSharedContainers and Paths.document.uri constants only
import { Paths } from 'expo-file-system'
import { Platform } from 'react-native'

export function getAppGroup(): string | undefined {
  return Constants.expoConfig?.extra?.appGroup
}

/**
 * Returns the base storage directory URI with `file://` prefix.
 * On iOS, this is the app group shared container (required for extensions).
 * On Android, this is the default document directory.
 */
export function getStorageDirectoryUri(): string {
  if (Platform.OS === 'ios') {
    const appGroup = getAppGroup()
    if (!appGroup) throw new Error('appGroup not configured in app.config.js')
    const containers = Paths.appleSharedContainers
    if (!containers) throw new Error('appleSharedContainers not available')
    const container = containers[appGroup]
    if (!container)
      throw new Error(`App group container not found: ${appGroup}`)
    return container.uri
  }
  return Paths.document.uri
}

/**
 * Returns the directory path for expo-sqlite's `directory` parameter.
 * On iOS, points to the shared app group container so extensions
 * can access the same database. On Android, returns undefined
 * to use the default location.
 */
export function getSharedDbDirectory(): string | undefined {
  if (Platform.OS !== 'ios') return undefined
  return getStorageDirectoryUri().replace('file://', '')
}
