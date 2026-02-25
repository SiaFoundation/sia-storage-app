import { logger } from '@siastorage/logger'
import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { processAssets } from '../lib/processAssets'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'
import type { FileRecord } from '../stores/files'

export function useDocumentPicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<FileRecord[]> => {
    if (isPickingRef.current) {
      logger.debug('documentPicker', 'already_picking')
      return []
    }
    isPickingRef.current = true
    try {
      logger.debug('documentPicker', 'opening')
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        type: '*/*',
        copyToCacheDirectory: true,
      })

      if (result.canceled) {
        logger.debug('documentPicker', 'canceled')
        return []
      }

      const { files, warnings } = await processAssets(
        result.assets?.map((a) => ({
          id: undefined,
          name: a.name,
          size: a.size,
          type: a.mimeType,
          timestamp: new Date(a.lastModified).toISOString(),
          sourceUri: a.uri,
        })),
        'file',
        { allowDuplicates: true },
      )
      if (warnings.length > 0) {
        warnings.forEach((warning) => toast.show(warning))
      }

      return files
    } catch (e) {
      logger.error('documentPicker', 'error', { error: e as Error })
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [toast.show])
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
