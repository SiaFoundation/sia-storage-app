import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
import { extFromMime, getMimeType } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import { FileRecord } from '../stores/files'
import { useUploader } from '../managers/uploader'
import { processAssets } from '../lib/processAssets'

export function useCameraCapture() {
  const toast = useToast()
  const isCapturingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isCapturingRef.current) {
      logger.debug('cameraCapture', 'already capturing, ignoring new request.')
      return []
    }
    isCapturingRef.current = true
    try {
      logger.debug('cameraCapture', 'opening camera...')
      const result = await ImagePicker.launchCamera({
        mediaType: 'mixed',
        saveToPhotos: false,
        includeExtra: true,
        // Docs: A mode that determines which representation to use if an asset contains more than one on iOS or disables HEIC/HEIF to JPEG conversion on Android if set to 'current'.
        assetRepresentationMode: 'current',
        quality: 1,
        videoQuality: 'high',
      })

      if (result.didCancel) {
        logger.debug('cameraCapture', 'capture canceled.')
        return []
      }
      if (result.errorCode) {
        logger.warn(
          'cameraCapture',
          `error: ${result.errorMessage ?? result.errorCode}`
        )
        return []
      }

      const first = (result.assets ?? [])[0]
      if (!first || !first.uri) {
        toast.show('No media captured.')
        return []
      }

      const { files, warnings } = await processAssets(
        await Promise.all(
          (result.assets ?? []).map(async (a) => ({
            id: a.id,
            name: buildDateFileName(
              a.timestamp,
              await getMimeType({
                type: a.type,
                name: a.fileName,
                uri: a.uri,
              })
            ),
            size: a.fileSize,
            type: a.type,
            sourceUri: a.uri,
            timestamp: a.timestamp,
          }))
        )
      )
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }

      return files
    } catch (e) {
      logger.error('cameraCapture', 'error', e)
      return []
    } finally {
      isCapturingRef.current = false
    }
  }, [toast])
}

export function useCameraCaptureAndUpload() {
  const capture = useCameraCapture()
  const uploader = useUploader()
  return useCallback(async () => {
    const files = await capture()
    if (files && files.length > 0) {
      await uploader(files)
    }
  }, [capture, uploader])
}

/* Build a date-based file name from a timestamp and mime type.
 * eg: Camera Capture 2025-11-03 2.36.59 PM.jpg
 */
function buildDateFileName(
  timestamp: string | undefined,
  mime: string | undefined
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
