import { uploadToIndexer } from './uploadToIndexer'
import {
  writeToCache,
  copyUriToCache,
  readCachedUri,
} from '../stores/fileCache'
import * as FileSystem from 'expo-file-system'
import { setUploadState } from '../stores/uploadState'
import { useCallback } from 'react'
import { useSettings } from '../lib/settingsContext'
import { extFromMime } from '../lib/fileTypes'
import {
  encryptionKeyHexToUint8,
  encryptionKeyUint8ToHex,
} from '../lib/encryptionKey'
import { createFileRecord, readFileRecord } from '../stores/files'
import { logger } from '../lib/logger'
import { getGlobalSlotPool } from './slotPool'
import { registerTransfer, unregisterTransfer } from '../stores/transfers'
import { PickerAsset } from '../hooks/useFilePicker'

export function useUploader() {
  const { sdk, indexerURL } = useSettings()
  return useCallback(
    async (assets: PickerAsset[]) => {
      try {
        for (const asset of assets) {
          logger.log(
            '[uploader] creating file record for asset',
            asset.id,
            asset.fileName,
            asset.fileType
          )
          setUploadState(asset.id, { status: 'uploading', progress: 0 })
          await createFileRecord({
            id: asset.id,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            createdAt: asset.createdAt,
            fileType: asset.fileType,
            pinnedObjects: {},
            encryptionKey: encryptionKeyUint8ToHex(asset.encryptionKey),
          })
        }
        await Promise.all(
          assets.map(async (asset: PickerAsset, index: number) => {
            try {
              // Ensure progress is visible before entering the slot.
              setUploadState(asset.id, { status: 'uploading', progress: 0 })
              await getGlobalSlotPool().withSlot(async () => {
                logger.log(
                  `[uploader] processing media ${index + 1}/${assets.length}...`
                )
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
                logger.log(`[uploader] cached file ${asset.id} -> ${cacheUri}`)
                logger.log(`[uploader] uploading ${asset.id} to hosts...`)
                const fileBytes = await new FileSystem.File(cacheUri).bytes()
                const controller = registerTransfer(asset.id, 'upload')
                try {
                  await uploadToIndexer({
                    file: asset,
                    indexerURL,
                    sdk,
                    data: fileBytes.buffer as ArrayBuffer,
                    signal: controller.signal,
                  })
                } finally {
                  unregisterTransfer(asset.id)
                }
                logger.log(`[uploader] upload complete ${asset.id}`)
              })
            } catch (e) {
              logger.log(`[uploader] error for file ${asset.id}: ${String(e)}`)
            }
          })
        )
        logger.log('[uploader] all selected assets processed.')
      } catch (e) {
        logger.log(`[uploader] error: ${String(e)}`)
      }
    },
    [sdk]
  )
}

export function useReuploadFile() {
  const { sdk, indexerURL } = useSettings()
  return useCallback(
    async (fileId: string) => {
      await getGlobalSlotPool().withSlot(async () => {
        try {
          const file = await readFileRecord(fileId)
          if (!file) {
            throw new Error('File not found')
          }
          const cacheUri = await readCachedUri(
            fileId,
            extFromMime(file.fileType)
          )
          if (!cacheUri) {
            throw new Error('File not cached')
          }
          setUploadState(fileId, { status: 'uploading', progress: 0 })
          logger.log(`[uploader] uploading ${fileId}...`)
          const fileBytes = await new FileSystem.File(cacheUri).bytes()
          await uploadToIndexer({
            file: {
              id: fileId,
              fileName: file.fileName,
              fileType: file.fileType,
              fileSize: file.fileSize,
              encryptionKey: encryptionKeyHexToUint8(file.encryptionKey),
            },
            indexerURL,
            sdk,
            data: fileBytes.buffer,
          })
          logger.log(`[uploader] upload complete ${fileId}`)
        } catch (e) {
          logger.log(`[uploader] error for file ${fileId}: ${String(e)}`)
        }
      })
    },
    [sdk]
  )
}

async function readArrayBuffer(asset: PickerAsset): Promise<ArrayBuffer> {
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
