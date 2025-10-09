import { uploadToIndexer } from './uploadToIndexer'
import {
  writeToCache,
  copyUriToCache,
  readCachedUri,
} from '../stores/fileCache'
import * as FileSystem from 'expo-file-system'
import { useCallback } from 'react'
import { useSdk, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import { extFromMime } from '../lib/fileTypes'
import {
  insertOrReplaceManyFileRecords,
  FileRecord,
  readFileRecord,
} from '../stores/files'
import { logger } from '../lib/logger'
import { PickerAsset } from '../hooks/useImagePicker'
import { runTransferWithSlot } from '../stores/transfers'

export function useUploader() {
  const sdk = useSdk()
  return useCallback(
    async (assets: PickerAsset[]) => {
      if (!sdk) {
        logger.log('[uploader] sdk not initialized')
        return
      }
      try {
        const fileRecords: FileRecord[] = []
        for (const asset of assets) {
          logger.log(
            '[uploader] creating file record for asset',
            asset.id,
            asset.fileName,
            asset.fileType
          )
          fileRecords.push({
            id: asset.id,
            cid: null,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            createdAt: asset.createdAt,
            fileType: asset.fileType,
            sealedObjects: {},
          })
        }
        await insertOrReplaceManyFileRecords(fileRecords)
        await Promise.all(
          assets.map(async (asset: PickerAsset, index: number) => {
            logger.log(
              `[uploader] processing media ${index + 1}/$${assets.length}...`
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
            runTransferWithSlot({
              id: asset.id,
              kind: 'upload',
              task: async (signal) => {
                const indexerURL = await getIndexerURL()
                logger.log(`[uploader] uploading ${asset.id} to hosts...`)
                const fileBytes = await new FileSystem.File(cacheUri).bytes()
                await uploadToIndexer({
                  file: {
                    id: asset.id,
                    fileName: asset.fileName,
                    fileType: asset.fileType,
                    fileSize: asset.fileSize,
                  },
                  indexerURL,
                  sdk,
                  data: fileBytes.buffer as ArrayBuffer,
                  signal,
                })
                logger.log(`[uploader] upload complete ${asset.id}`)
              },
            })
          })
        )
        logger.log('[uploader] all selected assets processed.')
      } catch (e) {
        logger.log(`[uploader] error`, e)
      }
    },
    [sdk]
  )
}

export function useReuploadFile() {
  return useCallback(
    async (fileId: string) =>
      runTransferWithSlot({
        id: fileId,
        kind: 'upload',
        task: async (signal) => {
          const sdk = getSdk()
          if (!sdk) throw new Error('SDK not initialized')
          const indexerURL = await getIndexerURL()
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
          logger.log(`[uploader] uploading ${fileId}...`)
          const fileBytes = await new FileSystem.File(cacheUri).bytes()
          await uploadToIndexer({
            file: {
              id: fileId,
              fileName: file.fileName,
              fileType: file.fileType,
              fileSize: file.fileSize,
            },
            indexerURL,
            sdk,
            data: fileBytes.buffer,
            signal,
          })
          logger.log(`[uploader] upload complete ${fileId}`)
        },
      }),
    []
  )
}

export async function queueUploadForFileId(fileId: string): Promise<void> {
  const file = await readFileRecord(fileId)
  if (!file) return
  const cachedUri = await readCachedUri(fileId, extFromMime(file.fileType))
  if (!cachedUri) return
  const indexerURL = await getIndexerURL()
  const sdk = getSdk()
  if (!sdk) return
  await runTransferWithSlot({
    id: fileId,
    kind: 'upload',
    task: async (signal) => {
      const fileBytes = await new FileSystem.File(cachedUri).bytes()
      await uploadToIndexer({
        file: {
          id: fileId,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
        },
        indexerURL,
        sdk,
        data: fileBytes.buffer as ArrayBuffer,
        signal,
      })
    },
  })
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
