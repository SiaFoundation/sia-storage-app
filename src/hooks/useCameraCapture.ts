import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
import { mimeFromAssetUri } from '../lib/fileTypes'
import { uniqueId } from '../lib/uniqueId'
import { logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import { type PickerAsset } from './useImagePicker'
import { useUploader } from '../managers/uploader'

export function useCameraCapture() {
  const toast = useToast()
  const isCapturingRef = useRef<boolean>(false)
  return useCallback(async () => {
    if (isCapturingRef.current) {
      logger.log('[cameraCapture] already capturing, ignoring new request.')
      return [] as PickerAsset[]
    }
    isCapturingRef.current = true
    try {
      logger.log('[cameraCapture] opening camera...')
      const result = await ImagePicker.launchCamera({
        mediaType: 'mixed',
        includeExtra: true,
        includeBase64: true,
        saveToPhotos: false,
      })

      if (result.didCancel) {
        logger.log('[cameraCapture] capture canceled.')
        return [] as PickerAsset[]
      }
      if (result.errorCode) {
        logger.log(
          `[cameraCapture] error: ${result.errorMessage ?? result.errorCode}`
        )
        return [] as PickerAsset[]
      }

      const first = (result.assets ?? [])[0]
      if (!first || !first.uri) {
        toast.show('No media captured.')
        return [] as PickerAsset[]
      }

      const asset: PickerAsset = {
        id: uniqueId(),
        uri: first.uri,
        fileType: mimeFromAssetUri(first),
        createdAt: Date.now(),
        fileSize: first.fileSize ?? 0,
        fileName:
          first.fileName ??
          (first.type?.startsWith('video') ? 'camera-video' : 'camera-photo'),
      }

      return [asset]
    } catch (e) {
      logger.log('[cameraCapture] error', e)
      return [] as PickerAsset[]
    } finally {
      isCapturingRef.current = false
    }
  }, [toast])
}

export function useCameraCaptureAndUpload() {
  const capture = useCameraCapture()
  const uploader = useUploader()
  return useCallback(async () => {
    const assets = await capture()
    if (assets && assets.length > 0) {
      await uploader(assets)
    }
  }, [capture, uploader])
}
