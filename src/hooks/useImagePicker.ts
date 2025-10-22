import * as ImagePicker from 'react-native-image-picker'
import { useCallback, useRef } from 'react'
import { uniqueId } from '../lib/uniqueId'
import { logger } from '../lib/logger'
import { useToast } from '../lib/toastContext'
import { useUploader } from '../managers/uploader'
import { readFileRecordsByLocalIds } from '../stores/files'
import { mimeFromAssetUri } from '../lib/fileTypes'

export type PickerAsset = {
  id: string
  localId: string | null
  fileName: string
  fileSize: number
  createdAt: number
  fileType: string
  width?: number
  height?: number
  duration?: number
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
      ) as {
        id: string
        type: string | undefined
        fileName: string
        fileSize: number
        // This uri is not necessarily a local URI, it could be a network URI.
        // so we should not assume it can be used to read the file bytes.
        uri: string
      }[]

      // Check for easy localId in the files database, filter out any files that already exist.
      const existingFiles = await readFileRecordsByLocalIds(
        assetsWithRequiredFields.map((a) => a.id)
      )

      const newAssets = assetsWithRequiredFields.filter(
        (a) => !existingFiles.some((f) => f.localId === a.id)
      )

      const withoutRequiredFieldsCount =
        assetsWithRequiredFields.length - newAssets.length
      const existingFilesCount = existingFiles.length
      if (withoutRequiredFieldsCount > 0) {
        toast.show(
          'Some files were missing required metadata and were not included.'
        )
      }
      if (existingFilesCount > 0) {
        toast.show('Some files were duplicates and were not included.')
      }

      const assets = newAssets.map((a) => ({
        id: uniqueId(),
        localId: a.id,
        fileType: a.type ?? mimeFromAssetUri(a),
        createdAt: Date.now(),
        fileSize: a.fileSize,
        fileName: a.fileName,
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
