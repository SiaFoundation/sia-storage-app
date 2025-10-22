import * as MediaLibrary from 'expo-media-library'
import { logger } from './logger'

export async function ensurePhotosPermission(): Promise<boolean> {
  const res = await MediaLibrary.requestPermissionsAsync()
  return res.granted === true
}
