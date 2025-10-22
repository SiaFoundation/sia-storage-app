import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
import { logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'
import { proccessAssets } from '../lib/processAssets'
import { FileRecord } from '../stores/files'

export function useImagePicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isPickingRef.current) {
      logger.log('[imagePicker] already picking, ignoring new request.')
      return []
    }
    isPickingRef.current = true
    try {
      logger.log('[imagePicker] opening media picker...')
      const result = await ImagePicker.launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0, // 0 => unlimited on iOS; Android uses picker default multi-select UI if available.
        includeExtra: true,
      })

      if (result.didCancel) {
        logger.log('[imagePicker] media selection canceled.')
        return []
      }
      if (result.errorCode) {
        logger.log(
          `[imagePicker] error: ${result.errorMessage ?? result.errorCode}`
        )
        return []
      }

      const { files, warnings } = await proccessAssets(result.assets ?? [])
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }
      return files
    } catch (e) {
      logger.log('[imagePicker] error', e)
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [])
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
