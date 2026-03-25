import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { importFiles } from '../lib/processAssets'

export function useDocumentPicker() {
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
        copyToCacheDirectory: false,
      })

      if (result.canceled) {
        logger.debug('documentPicker', 'canceled')
        return []
      }

      return importFiles(
        result.assets?.map((a) => ({
          id: undefined,
          name: a.name,
          size: a.size,
          type: a.mimeType,
          timestamp: new Date(a.lastModified).toISOString(),
          sourceUri: a.uri,
        })),
        'file',
      )
    } catch (e) {
      logger.error('documentPicker', 'error', { error: e as Error })
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [])
}
