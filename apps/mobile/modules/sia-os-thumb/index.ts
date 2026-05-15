import { requireOptionalNativeModule } from 'expo'

export type OsThumbResult = {
  /** `file://` path to the JPEG the native side wrote to the app cache. */
  uri: string
  width: number
  height: number
  mimeType: 'image/jpeg'
}

type NativeModule = {
  getOsThumbnail(localId: string, targetSize: number): Promise<OsThumbResult | null>
}

const native = requireOptionalNativeModule<NativeModule>('SiaOsThumb')

/**
 * Writes a system-cached thumbnail of a media-library asset to the app cache
 * directory and returns its `file://` path. iOS reads from the Photos
 * framework's thumbnail cache via PHImageManager (fastFormat, exact, no iCloud
 * fetch); Android reads from MediaProvider via ContentResolver.loadThumbnail
 * (API 29+). Decode/scale and the disk write all run in the OS media daemon
 * and native side — no bytes ever cross the JS bridge.
 *
 * Returns null when the asset doesn't exist, the platform can't fulfill the
 * request (cloud-only on Android, permission revoked, API < 29 on Android,
 * native module absent), or anything else short of a genuine programming bug.
 * Callers fall back to the in-process resizeToWebP path on null.
 */
export async function getOsThumbnail(
  localId: string,
  targetSize: number,
): Promise<OsThumbResult | null> {
  if (!native) return null
  return native.getOsThumbnail(localId, targetSize)
}
