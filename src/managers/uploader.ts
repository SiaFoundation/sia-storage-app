import { uploadToNetwork } from './uploadToNetwork'
import { getFsFileUri } from '../stores/fs'
import { useCallback } from 'react'
import { useSdk, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import { FileRecord, readFileRecord } from '../stores/files'
import { logger } from '../lib/logger'
import { runUploadWithSlot } from '../stores/uploads'

export function useUploader() {
  const sdk = useSdk()
  return useCallback(
    async (files: FileRecord[]) => {
      if (!sdk) {
        logger.log('[uploader] sdk not initialized')
        return
      }
      try {
        await Promise.all(
          files.map(async (file: FileRecord, index: number) => {
            logger.log(
              `[uploader] processing media ${index + 1}/${files.length}...`
            )
            const fileUri = await getFsFileUri(file)
            if (!fileUri) {
              logger.log(`[uploader] file not available locally ${file.id}`)
              return
            }
            logger.log(`[uploader] cached file ${file.id} -> ${fileUri}`)
            runUploadWithSlot({
              id: file.id,
              task: async (signal) => {
                const indexerURL = await getIndexerURL()
                logger.log(`[uploader] uploading ${file.id} to hosts...`)
                await uploadToNetwork({
                  file,
                  indexerURL,
                  sdk,
                  fileUri,
                  signal,
                })
                logger.log(`[uploader] upload complete ${file.id}`)
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
          const fileUri = await getFsFileUri(file)
          if (!fileUri) {
            throw new Error('File not available locally')
          }
          logger.log(`[uploader] uploading ${fileId}...`)
          await uploadToNetwork({
            file,
            indexerURL,
            sdk,
            fileUri,
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
  const fileUri = await getFsFileUri(file)
  if (!fileUri) return
  const indexerURL = await getIndexerURL()
  const sdk = getSdk()
  if (!sdk) return
  await runUploadWithSlot({
    id: fileId,
    task: async (signal) => {
      await uploadToNetwork({
        file,
        indexerURL,
        sdk,
        fileUri,
        signal,
      })
    },
  })
}
