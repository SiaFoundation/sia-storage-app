import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { showImportResultToast } from '../lib/importResultToast'
import type { ImportFilesOptions } from '../lib/processAssets'
import { importFiles } from '../lib/processAssets'
import { useToast } from '../lib/toastContext'

export function useDocumentPicker(options: ImportFilesOptions = {}) {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  const { destinationDirectoryId, assignTagName } = options
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
        copyToCacheDirectory: false,
      })

      if (result.canceled) {
        logger.debug('documentPicker', 'canceled')
        return []
      }

      const imported = await importFiles(
        result.assets?.map((a) => ({
          id: undefined,
          name: a.name,
          size: a.size,
          type: a.mimeType,
          timestamp: new Date(a.lastModified).toISOString(),
          sourceUri: a.uri,
        })),
        'file',
        { destinationDirectoryId, assignTagName },
      )
      showImportResultToast(toast, imported)
      return imported.files
    } catch (e) {
      logger.error('documentPicker', 'error', { error: e as Error })
      toast.show('Could not add files. Please try again.')
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [toast, destinationDirectoryId, assignTagName])
}
