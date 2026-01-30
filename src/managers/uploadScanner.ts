import { SCANNER_INTERVAL, SLAB_SIZE } from '../config'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { humanUploadPercent } from '../lib/uploadPercent'
import {
  type FileRecord,
  getFilesLocalOnly,
  useFileCountAll,
  useFileCountLocal,
} from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { getIsConnected, getSdk } from '../stores/sdk'
import {
  getAutoScanUploads,
  getIndexerURL,
  useAutoScanUploads,
} from '../stores/settings'
import { getActiveUploads, useActiveUploads } from '../stores/uploads'
import { type FileEntry, getUploadManager } from './uploader'

async function toFileEntry(file: FileRecord): Promise<FileEntry | null> {
  const fileUri = await getFsFileUri(file)
  if (!fileUri) return null
  return { fileId: file.id, fileUri, file, size: file.size }
}

async function startUploadScanner(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.debug('uploadScanner', 'not connected to indexer, skipping scan')
    return
  }

  const sdk = getSdk()
  if (!sdk) {
    logger.debug('uploadScanner', 'SDK not initialized, skipping scan')
    return
  }

  try {
    logger.debug('uploadScanner', 'scanning...')
    const uploadManager = getUploadManager()
    const indexerURL = await getIndexerURL()
    uploadManager.initialize(sdk, indexerURL)

    // Check how much space is left in current slab
    const slabRemaining = await uploadManager.getSlabRemaining()

    // Get candidate files, sorted by size ascending (small files first)
    const candidateFiles = await getFilesLocalOnly({
      limit: 200,
      order: 'ASC',
    })

    // Filter out files already being uploaded
    const activeUploads = getActiveUploads()
    const available = candidateFiles.filter(
      (f) => !activeUploads.some((u) => u.id === f.id),
    )

    // Select files that fit well in current slab
    const toUpload: FileEntry[] = []
    let batchSize = 0
    const targetBatchSize = Number(
      slabRemaining > 0n ? slabRemaining : BigInt(SLAB_SIZE),
    )

    for (const file of available) {
      const entry = await toFileEntry(file)
      if (!entry) continue

      // Always include at least one file
      if (toUpload.length === 0) {
        toUpload.push(entry)
        batchSize += file.size
        continue
      }

      // Add more files if they fit well in the slab
      if (batchSize + file.size <= targetBatchSize) {
        toUpload.push(entry)
        batchSize += file.size
      }

      // Stop if we've filled the slab target
      if (batchSize >= targetBatchSize) break
    }

    if (toUpload.length > 0) {
      logger.info(
        'uploadScanner',
        `queuing ${toUpload.length} files (${batchSize} bytes)`,
      )
      await uploadManager.queueFiles(toUpload)
    }
  } catch (e) {
    logger.error('uploadScanner', 'scan error', e)
  }
}

export const initUploadScanner = createServiceInterval({
  name: 'uploadScanner',
  worker: startUploadScanner,
  getState: getAutoScanUploads,
  interval: SCANNER_INTERVAL,
})

export function useUploadScannerStatus(): {
  show: boolean
  enabled: boolean
  remaining: number
  percentComplete: string
  total: number
} {
  const total = useFileCountAll()
  const localOnly = useFileCountLocal({ localOnly: true })
  const enabled = useAutoScanUploads()
  const activeUploads = useActiveUploads()
  const totalCount = total.data ?? 0
  const localOnlyCount = localOnly.data ?? 0
  const uploadedCount = totalCount - localOnlyCount
  const isEnabled = enabled.data ?? false
  const activeProgress = activeUploads
    .map((u) => u.progress)
    .reduce((a, b) => a + b, 0)
  const percentComplete = totalCount
    ? (activeProgress + uploadedCount) / totalCount
    : 0

  return {
    show: isEnabled && !!localOnlyCount,
    enabled: isEnabled,
    remaining: localOnlyCount,
    percentComplete: humanUploadPercent(percentComplete),
    total: total.data ?? 0,
  }
}
