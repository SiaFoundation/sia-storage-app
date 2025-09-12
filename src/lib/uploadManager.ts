import * as ImagePicker from 'react-native-image-picker'
import { uploadToSia } from './uploadToSia'
import { writeToCache, copyUriToCache } from './fileCache'
import * as FileSystem from 'expo-file-system'
import { setUploadState } from './uploadState'
import { useCallback } from 'react'
import { useSettings } from './settingsContext'
import { useFiles } from './filesContext'
import { extFromMime, mimeFromAssetUri } from './fileTypes'
import {
  encryptionKeyArrayBufferToHex,
  encryptionKeyHexToBuffer,
  encryptionKeyUint8ToHex,
  generateEncryptionKey,
  generateEncryptionKeyHex,
} from './encryptionKey'
import { uniqueId } from './uniqueId'

export type PickerAsset = {
  id: string
  uri: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  encryptionKey?: Uint8Array
}

export function usePickAndUploadMedia() {
  const { sdk, log, indexerURL } = useSettings()
  const { createFile } = useFiles()
  return useCallback(async () => {
    try {
      log('Opening media picker...')
      const result = await ImagePicker.launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0, // 0 => unlimited on iOS; Android uses picker default multi-select UI if available.
        includeExtra: true,
        includeBase64: true,
      })

      if (result.didCancel) {
        log('Media selection canceled.')
        return []
      }
      if (result.errorCode) {
        log(`Media picker error: ${result.errorMessage ?? result.errorCode}`)
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
        }))

      if (assets.length === 0) {
        log('No media selected.')
        return []
      }

      for (const asset of assets) {
        log(
          'Creating file record for asset',
          asset.id,
          asset.fileName,
          asset.fileType
        )
        setUploadState(asset.id, { status: 'uploading', progress: 0 })
        // Emit incrementally so the gallery can show thumbnails from cache immediately.
        asset.encryptionKey = generateEncryptionKey()
        await createFile({
          id: asset.id,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          createdAt: asset.createdAt,
          fileType: asset.fileType,
          pinnedObjects: null,
          encryptionKey: encryptionKeyUint8ToHex(asset.encryptionKey),
        })
      }

      const readArrayBuffer = async (
        asset: PickerAsset
      ): Promise<ArrayBuffer> => {
        const uri = asset.uri as string
        try {
          const response = await fetch(uri)
          return await response.arrayBuffer()
        } catch {
          // Fallback for content:// URIs on Android.
          const file = new FileSystem.File(uri)
          const bytes = await file.bytes()
          return bytes.buffer as ArrayBuffer
        }
      }

      // Upload with limited concurrency to avoid overwhelming the device/network.
      const CONCURRENCY_LIMIT = 5

      let nextIndex = 0
      const worker = async () => {
        while (true) {
          const currentIndex = nextIndex
          nextIndex += 1
          if (currentIndex >= assets.length) return

          const asset = assets[currentIndex]
          if (!asset || !asset.encryptionKey) {
            continue
          }
          try {
            log(`Processing media ${currentIndex + 1}/${assets.length}...`)
            const cacheUri = asset.uri
              ? await copyUriToCache(
                  asset.id,
                  asset.uri,
                  extFromMime(asset.fileType)
                )
              : await writeToCache(
                  asset.id,
                  await readArrayBuffer(asset),
                  extFromMime(asset.fileType)
                )
            log(`Cached file ${asset.id} -> ${cacheUri}`)
            const cachedItem: PickerAsset = { ...asset, uri: cacheUri }
            log(`Uploading ${asset.id} to Sia...`)
            // Stream from cached file to keep memory low.
            const fileBytes = await new FileSystem.File(cacheUri).bytes()
            await uploadToSia({
              asset,
              indexerURL,
              log,
              sdk,
              encryptionKey: asset.encryptionKey,
              data: fileBytes.buffer as ArrayBuffer,
            })
            log(`Upload complete ${asset.id}`)
            const done: PickerAsset = {
              ...cachedItem,
            }
            assets[currentIndex] = done
          } catch (e) {
            log(`Upload flow error: ${String(e)}`)
            const errored: PickerAsset = { ...asset }
            assets[currentIndex] = errored
          }
        }
      }

      const workerCount = Math.min(CONCURRENCY_LIMIT, assets.length)
      await Promise.all(Array.from({ length: workerCount }, () => worker()))

      log('All selected assets processed.')
      return assets
    } catch (e) {
      log(`Upload flow error: ${String(e)}`)
      return []
    }
  }, [sdk, log])
}
