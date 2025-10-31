import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
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
      logger.log('[cameraCapture] already capturing, ignoring new request.')
      return []
    }
    isCapturingRef.current = true
    try {
      logger.log('[cameraCapture] opening camera...')
      const result = await ImagePicker.launchCamera({
        mediaType: 'mixed',
        includeExtra: true,
        saveToPhotos: false,
      })

      if (result.didCancel) {
        logger.log('[cameraCapture] capture canceled.')
        return []
      }
      if (result.errorCode) {
        logger.log(
          `[cameraCapture] error: ${result.errorMessage ?? result.errorCode}`
        )
        return []
      }

      const first = (result.assets ?? [])[0]
      if (!first || !first.uri) {
        toast.show('No media captured.')
        return []
      }

      const { files, warnings } = await processAssets(
        result.assets?.map((a) => ({
          id: a.id,
          name: a.fileName,
          size: a.fileSize,
          type: a.type,
          sourceUri: a.uri,
          timestamp: a.timestamp,
        }))
      )
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }

      return files
    } catch (e) {
      logger.log('[cameraCapture] error', e)
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
