import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'
import { proccessAssets } from '../lib/processAssets'
import { FileRecord } from '../stores/files'

export function useDocumentPicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isPickingRef.current) {
      logger.log('[documentPicker] already picking, ignoring new request.')
      return []
    }
    isPickingRef.current = true
    try {
      logger.log('[documentPicker] opening document picker...')
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        type: '*/*',
        copyToCacheDirectory: true,
      })

      logger.log('[documentPicker] result', result)

      if (result.canceled) {
        logger.log('[documentPicker] selection canceled.')
        return []
      }

      const { files, warnings } = await proccessAssets(result.assets ?? [])
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }

      return files
    } catch (e) {
      logger.log('[documentPicker] error', e)
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [])
}

export function useDocumentPickerAndUpload() {
  const pickAssets = useDocumentPicker()
  const uploader = useUploader()
  return useCallback(async () => {
    const files = await pickAssets()
    if (files.length > 0) {
      await uploader(files)
    }
  }, [pickAssets, uploader])
}
