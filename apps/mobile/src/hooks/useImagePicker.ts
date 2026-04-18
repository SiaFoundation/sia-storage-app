import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback, useRef } from 'react'
import * as ImagePicker from 'react-native-image-picker'
import { showPermissionDeniedAlert } from '../lib/permissionAlert'
import { importFiles } from '../lib/processAssets'

export function useImagePicker() {
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
        // Docs: A mode that determines which representation to use if an asset
        // contains more than one on iOS or disables HEIC/HEIF to JPEG conversion on Android
        // if set to 'current'.
        assetRepresentationMode: 'current',
        videoQuality: 'high',
        quality: 1,
      })

      if (result.didCancel) {
        logger.debug('imagePicker', 'canceled')
        return []
      }
      if (result.errorCode === 'permission') {
        showPermissionDeniedAlert(
          'Photo Access Required',
          'To choose photos and videos, allow photo library access in Settings.',
        )
        return []
      }
      if (result.errorCode) {
        logger.warn('imagePicker', 'picker_error', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        })
        return []
      }

      return importFiles(
        result.assets?.map((a) => ({
          id: a.id,
          name: a.fileName,
          size: a.fileSize,
          type: a.type,
          timestamp: a.timestamp,
          sourceUri: a.uri,
        })),
        'file',
      )
    } catch (e) {
      logger.error('imagePicker', 'error', { error: e as Error })
      return []
    } finally {
      isPickingRef.current = false
    }
  }, [])
}
