import { swrCache } from '@siastorage/core/stores'
import * as MediaLibrary from 'expo-media-library'
import { useCallback, useMemo } from 'react'
import { Linking, Platform } from 'react-native'
import useSWR from 'swr'
import { palette } from '../styles/colors'

// Restrict the granular permission set to the media we actually use. With no
// arg, expo-media-library on Android requires photo + video + audio to all
// be granted before reporting `granted=true`. Android's "Photos and videos"
// permission UI only controls photo+video; READ_MEDIA_AUDIO lives under a
// separate "Music and audio" group the user is never prompted for, so it
// stays denied and the combined check never flips to ALL.
const GRANULAR: MediaLibrary.GranularPermission[] = ['photo', 'video']

export async function ensureMediaLibraryPermission(): Promise<boolean> {
  const res = await MediaLibrary.requestPermissionsAsync(false, GRANULAR)
  return res.granted === true
}

export async function getMediaLibraryPermissions(): Promise<boolean> {
  const res = await MediaLibrary.getPermissionsAsync(false, GRANULAR)
  return res.granted === true
}

/** Device media library permission status. */
export const mediaLibraryPermissionsCache = swrCache()

export function useMediaLibraryPermissions() {
  const perms = useSWR(mediaLibraryPermissionsCache.key(), () =>
    MediaLibrary.getPermissionsAsync(false, GRANULAR),
  )

  const photosAccess: 'all' | 'limited' | 'none' | 'unknown' = useMemo(() => {
    const p = perms.data
    if (!p) return 'unknown'
    const accessPrivileges = p.accessPrivileges
    if (accessPrivileges) return accessPrivileges
    return p.granted ? 'all' : 'none'
  }, [perms.data])

  const isFullAccess = photosAccess === 'all'
  const isSomeAccess = photosAccess === 'limited' || photosAccess === 'all'
  const accessLabel =
    photosAccess === 'all'
      ? 'Full access'
      : photosAccess === 'limited'
        ? 'Access limited (selected photos)'
        : photosAccess === 'none'
          ? 'No access, tap to grant access'
          : 'Unknown access'
  const color =
    photosAccess === 'all'
      ? palette.blue[400]
      : photosAccess === 'limited'
        ? palette.yellow[400]
        : photosAccess === 'none'
          ? palette.red[500]
          : palette.gray[500]

  const manageAccess = useCallback(async () => {
    // First-time grant: trigger the OS permission prompt directly. iOS
    // doesn't add the Photos row to an app's Settings page until the app
    // has called requestPermissionsAsync at least once, so opening Settings
    // before that lands on a page with no Photos row to toggle.
    if (photosAccess === 'none' || photosAccess === 'unknown') {
      const result = await MediaLibrary.requestPermissionsAsync(false, GRANULAR)
      mediaLibraryPermissionsCache.invalidate()
      if (result.granted || result.canAskAgain) return
      // Permanently denied — fall through to open Settings so the user
      // can flip the now-visible Photos row.
    }
    if (Platform.OS === 'ios') {
      try {
        await Linking.openURL('app-settings:')
        return
      } catch {}
    }
    try {
      await Linking.openSettings()
      return
    } catch {}
  }, [photosAccess])

  return {
    photosAccess,
    isFullAccess,
    isSomeAccess,
    accessLabel,
    color,
    manageAccess,
  }
}
