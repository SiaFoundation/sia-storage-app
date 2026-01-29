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
import {
  getActiveUploads,
  getUploadState,
  useActiveUploads,
} from '../stores/uploads'
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

  logger.debug('uploadScanner', 'scanning...')
  const uploadManager = getUploadManager()
  const indexerURL = await getIndexerURL()
  uploadManager.initialize(sdk, indexerURL)

  // Check how much space is left in current slab
  const slabRemaining = await uploadManager.getSlabRemaining()

  // Get candidate files, sorted by size ascending (small files first)
  const candidateFiles = await getFilesLocalOnly({
    limit: 50,
    order: 'ASC',
  })

  // Separate files into normal and errored, prioritizing normal files
  const activeUploads = getActiveUploads()
  const normalFiles: FileRecord[] = []
  const erroredFiles: FileRecord[] = []

  for (const f of candidateFiles) {
    // Skip if already in active upload queue
    if (activeUploads.some((u) => u.id === f.id)) continue
    const uploadState = getUploadState(f.id)
    if (uploadState?.status === 'error') {
      erroredFiles.push(f)
    } else {
      normalFiles.push(f)
    }
  }

  // Process normal files first, then errored files (deprioritized)
  const available = [...normalFiles, ...erroredFiles]

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
