import { logger } from '@siastorage/logger'
import { useCallback, useRef } from 'react'
import * as ImagePicker from 'react-native-image-picker'
import { processAssets } from '../lib/processAssets'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'
import type { FileRecord } from '../stores/files'

export function useImagePicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isPickingRef.current) {
      logger.debug('imagePicker', 'already_picking')
      return []
    }
    isPickingRef.current = true
    try {
      logger.debug('imagePicker', 'opening')
      const result = await ImagePicker.launchImageLibrary({
        mediaType: 'mixed',
        // 0 => unlimited on iOS; Android uses picker default multi-select UI if available.
        selectionLimit: 0,
        includeExtra: true,
        // Docs: A mode that determines which representation to use if an asset contains more than one on iOS or disables HEIC/HEIF to JPEG conversion on Android if set to 'current'.
        assetRepresentationMode: 'current',
        videoQuality: 'high',
        quality: 1,
      })

      if (result.didCancel) {
        logger.debug('imagePicker', 'canceled')
        return []
      }
      if (result.errorCode) {
        logger.warn('imagePicker', 'picker_error', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        })
        return []
      }

      const { files, warnings } = await processAssets(
        result.assets?.map((a) => ({
          id: a.id,
          name: a.fileName,
          size: a.fileSize,
          type: a.type,
          timestamp: a.timestamp,
          sourceUri: a.uri,
        })),
      )
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }
      return files
    } catch (e) {
      logger.error('imagePicker', 'error', { error: e as Error })
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [toast.show])
}

export function useImagePickerAndUpload() {
  const pickAssets = useImagePicker()
  const uploader = useUploader()
  return useCallback(async () => {
    const files = await pickAssets()
    if (files.length > 0) {
      await uploader(files)
    }
  }, [pickAssets, uploader])
}
