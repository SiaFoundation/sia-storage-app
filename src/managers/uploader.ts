import { uploadToIndexer } from './uploadToIndexer'
import { getFileUri, getLocalUri } from '../stores/fileCache'
import * as FileSystem from 'expo-file-system'
import { useCallback } from 'react'
import { useSdk, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import {
  createManyFileRecords,
  FileRecord,
  readFileRecord,
} from '../stores/files'
import { logger } from '../lib/logger'
import { PickerAsset } from '../hooks/useImagePicker'
import { runUploadWithSlot } from '../stores/uploads'
import { buildFingerprintV1, kindFromMime } from '../lib/fingerprint'

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
          const fingerprint = buildFingerprintV1({
            mime: asset.fileType,
            kind: kindFromMime(asset.fileType),
            width: asset.width,
            height: asset.height,
            durationMs: asset.duration,
            size: asset.fileSize,
            createdAtMs: asset.createdAt,
          })
          fileRecords.push({
            id: asset.id,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            updatedAt: asset.createdAt,
            createdAt: asset.createdAt,
            fileType: asset.fileType,
            localId: asset.localId,
            objects: {},
            fingerprint,
          })
        }
        await createManyFileRecords(fileRecords)
        await Promise.all(
          assets.map(async (asset: PickerAsset, index: number) => {
            logger.log(
              `[uploader] processing media ${index + 1}/$${assets.length}...`
            )
            const fileUri = await getLocalUri(asset.localId)
            if (!fileUri) {
              logger.log(`[uploader] file not found ${asset.id}`)
              return
            }
            logger.log(`[uploader] cached file ${asset.id} -> ${fileUri}`)
            runUploadWithSlot({
              id: asset.id,
              task: async (signal) => {
                const indexerURL = await getIndexerURL()
                logger.log(`[uploader] uploading ${asset.id} to hosts...`)
                const fileBytes = await new FileSystem.File(fileUri).bytes()
                await uploadToIndexer({
                  file: {
                    id: asset.id,
                    fileName: asset.fileName,
                    fileType: asset.fileType,
                    fileSize: asset.fileSize,
                    updatedAt: asset.createdAt,
                    createdAt: asset.createdAt,
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
      runUploadWithSlot({
        id: fileId,
        task: async (signal) => {
          const sdk = getSdk()
          if (!sdk) throw new Error('SDK not initialized')
          const indexerURL = await getIndexerURL()
          const file = await readFileRecord(fileId)
          if (!file) {
            throw new Error('File not found')
          }
          const fileUri = await getFileUri(file)
          if (!fileUri) {
            throw new Error('File not available locally')
          }
          logger.log(`[uploader] uploading ${fileId}...`)
          const fileBytes = await new FileSystem.File(fileUri).bytes()
          await uploadToIndexer({
            file: {
              id: fileId,
              fileName: file.fileName,
              fileType: file.fileType,
              fileSize: file.fileSize,
              updatedAt: file.updatedAt,
              createdAt: file.createdAt,
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
  const fileUri = await getFileUri(file)
  if (!fileUri) return
  const indexerURL = await getIndexerURL()
  const sdk = getSdk()
  if (!sdk) return
  await runUploadWithSlot({
    id: fileId,
    task: async (signal) => {
      const fileBytes = await new FileSystem.File(fileUri).bytes()
      await uploadToIndexer({
        file: {
          id: fileId,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          updatedAt: file.updatedAt,
          createdAt: file.createdAt,
        },
        indexerURL,
        sdk,
        data: fileBytes.buffer,
        signal,
      })
    },
  })
}
