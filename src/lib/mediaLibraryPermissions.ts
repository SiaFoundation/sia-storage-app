import { useFocusEffect } from '@react-navigation/native'
import * as MediaLibrary from 'expo-media-library'
import { useCallback, useMemo } from 'react'
import { Linking, Platform } from 'react-native'
import useSWR from 'swr'
import { palette } from '../styles/colors'
import { buildSWRHelpers } from './swr'

export async function ensureMediaLibraryPermission(): Promise<boolean> {
  const res = await MediaLibrary.requestPermissionsAsync()
  return res.granted === true
}

export async function getMediaLibraryPermissions(): Promise<boolean> {
  const res = await MediaLibrary.getPermissionsAsync()
  return res.granted === true
}

export const mediaLibraryPermissionsSwr = buildSWRHelpers(
  'mediaLibraryPermissions',
)

export function useMediaLibraryPermissions() {
  const perms = useSWR(mediaLibraryPermissionsSwr.getKey(), () =>
    MediaLibrary.getPermissionsAsync(),
  )

  useFocusEffect(
    useCallback(() => {
      void perms.mutate()
    }, [perms.mutate]),
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
    // Open app settings to adjust photo access for this app.
    // Try the URL scheme first on iOS, then generic openSettings as a fallback.
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
  }, [])

  return {
    photosAccess,
    isFullAccess,
    isSomeAccess,
    accessLabel,
    color,
    manageAccess,
  }
}
