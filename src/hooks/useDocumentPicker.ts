import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { type PickerAsset } from './useImagePicker'
import { uniqueId } from '../lib/uniqueId'
import { logger } from '../lib/logger'
import { generateEncryptionKey } from '../lib/encryptionKey'
import { mimeFromAssetUri } from '../lib/fileTypes'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'

export function useDocumentPicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<PickerAsset[]> => {
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

      const assetsWithRequiredFields = (result.assets ?? []).filter(
        (a) => a.uri && a.name && a.size
      )

      if (assetsWithRequiredFields.length !== result.assets?.length) {
        toast.show(
          `Assets without required fields: ${
            result.assets?.length
              ? result.assets.length - assetsWithRequiredFields.length
              : 0
          }`
        )
      }

      const assets: PickerAsset[] = assetsWithRequiredFields.map((a) => ({
        id: uniqueId(),
        uri: a.uri,
        fileName: a.name,
        fileSize: a.size ?? 0,
        createdAt: Date.now(),
        fileType: a.mimeType ?? mimeFromAssetUri(a),
        encryptionKey: generateEncryptionKey(),
      }))

      if (assets.length === 0) {
        logger.log('[documentPicker] no files selected.')
        return []
      }

      return assets
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
    const assets = await pickAssets()
    if (assets.length > 0) {
      await uploader(assets)
    }
  }, [pickAssets, uploader])
}
