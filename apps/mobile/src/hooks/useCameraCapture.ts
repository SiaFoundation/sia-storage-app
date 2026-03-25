import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback, useRef } from 'react'
import * as ImagePicker from 'react-native-image-picker'
import { extFromMime, getMimeType } from '../lib/fileTypes'
import { importFiles } from '../lib/processAssets'
import { useToast } from '../lib/toastContext'

export function useCameraCapture() {
  const toast = useToast()
  const isCapturingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isCapturingRef.current) {
      logger.debug('cameraCapture', 'already_capturing')
      return []
    }
    isCapturingRef.current = true
    try {
      logger.debug('cameraCapture', 'opening')
      const result = await ImagePicker.launchCamera({
        mediaType: 'mixed',
        saveToPhotos: false,
        includeExtra: true,
        // Docs: A mode that determines which representation to use if an asset
        // contains more than one on iOS or disables HEIC/HEIF to JPEG conversion on Android
        // if set to 'current'.
        assetRepresentationMode: 'current',
        quality: 1,
        videoQuality: 'high',
      })

      if (result.didCancel) {
        logger.debug('cameraCapture', 'canceled')
        return []
      }
      if (result.errorCode) {
        logger.warn('cameraCapture', 'picker_error', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        })
        return []
      }

      const first = (result.assets ?? [])[0]
      if (!first || !first.uri) {
        toast.show('No media captured.')
        return []
      }

      return importFiles(
        await Promise.all(
          (result.assets ?? []).map(async (a) => ({
            id: a.id,
            name: buildDateFileName(
              a.timestamp,
              await getMimeType({
                type: a.type,
                name: a.fileName,
                uri: a.uri,
              }),
            ),
            size: a.fileSize,
            type: a.type,
            sourceUri: a.uri,
            timestamp: a.timestamp,
          })),
        ),
        'file',
      )
    } catch (e) {
      logger.error('cameraCapture', 'error', { error: e as Error })
      return []
    } finally {
      isCapturingRef.current = false
    }
  }, [toast])
}

/* Build a date-based file name from a timestamp and mime type.
 * eg: Camera Capture 2025-11-03 2.36.59 PM.jpg
 */
function buildDateFileName(
  timestamp: string | undefined,
  mime: string | undefined,
): string {
  const d = timestamp ? new Date(timestamp) : new Date()

  const date = Number.isNaN(d.getTime()) ? new Date() : d

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  const hours24 = date.getHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const ampm = hours24 < 12 ? 'AM' : 'PM'

  const datePart = `${year}-${month}-${day}`
  const timePart = `${hours12}.${minutes}.${seconds}\u202F${ampm}`

  return `Camera Capture ${datePart} ${timePart}${extFromMime(mime)}`
}
