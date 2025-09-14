import * as ImagePicker from 'react-native-image-picker'
import { useCallback } from 'react'
import { mimeFromAssetUri } from '../lib/fileTypes'
import { uniqueId } from '../lib/uniqueId'
import { logger } from '../lib/logger'
import { generateEncryptionKey } from '../lib/encryptionKey'

export type PickerAsset = {
  id: string
  uri: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  encryptionKey: Uint8Array<ArrayBuffer>
  cacheUri?: string
}

export function useFilePicker() {
  return useCallback(async () => {
    try {
      logger.log('[filePicker] opening media picker...')
      const result = await ImagePicker.launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0, // 0 => unlimited on iOS; Android uses picker default multi-select UI if available.
        includeExtra: true,
        includeBase64: true,
      })

      if (result.didCancel) {
        logger.log('[filePicker] media selection canceled.')
        return []
      }
      if (result.errorCode) {
        logger.log(
          `[filePicker] error: ${result.errorMessage ?? result.errorCode}`
        )
        return []
      }

      const assets: PickerAsset[] = (result.assets ?? [])
        .filter((a): a is ImagePicker.Asset => Boolean(a && a.uri && a.id))
        .map((a) => ({
          ...a,
          id: uniqueId(),
          uri: a.uri as string,
          fileType: mimeFromAssetUri(a),
          createdAt: Date.now(),
          fileSize: a.fileSize ?? null,
          fileName: a.fileName ?? null,
          encryptionKey: generateEncryptionKey(),
        }))

      if (assets.length === 0) {
        logger.log('[filePicker] no media selected.')
        return []
      }

      return assets
    } catch (e) {
      logger.log('[filePicker] error', e)
    }
  }, [])
}
