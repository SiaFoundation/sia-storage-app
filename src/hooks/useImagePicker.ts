import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
import { mimeFromAssetUri } from '../lib/fileTypes'
import { uniqueId } from '../lib/uniqueId'
import { logger } from '../lib/logger'
import { generateEncryptionKey } from '../lib/encryptionKey'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'

export type PickerAsset = {
  id: string
  uri: string
  fileName: string
  fileSize: number
  createdAt: number
  fileType: string
  encryptionKey: Uint8Array<ArrayBuffer>
  cacheUri?: string
}

export function useImagePicker() {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  return useCallback(async (): Promise<PickerAsset[]> => {
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
        includeBase64: true,
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

      const assetsWithRequiredFields = (result.assets ?? []).filter(
        (a) => a.uri && a.id && a.fileName && a.fileSize
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
        uri: a.uri as string,
        fileType: mimeFromAssetUri(a),
        createdAt: Date.now(),
        fileSize: a.fileSize!,
        fileName: a.fileName!,
        encryptionKey: generateEncryptionKey(),
      }))

      if (assets.length === 0) {
        logger.log('[imagePicker] no media selected.')
        return []
      }

      return assets
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
    const assets = await pickAssets()
    if (assets.length > 0) {
      await uploader(assets)
    }
  }, [pickAssets, uploader])
}
