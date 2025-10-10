import { logger } from '../lib/logger'
import { getActiveUploads, useActiveUploads } from '../stores/uploads'
import {
  getFilesLocalOnly,
  useFileCountAll,
  useFileCountLocalOnly,
} from '../stores/files'
import { queueUploadForFileId } from './uploader'
import {
  SCANNER_MAX_TOTAL_UPLOADS_FACTOR,
  SCANNER_ADD_TO_QUEUE_FACTOR,
  SCANNER_INTERVAL,
} from '../config'
import { getIsConnected } from '../stores/sdk'
import { getAutoScanUploads, useAutoScanUploads } from '../stores/settings'
import { getMaxUploads } from '../managers/uploadsPool'
import { createServiceInterval } from '../lib/serviceInterval'

async function startUploadScanner(): Promise<void> {
  const isConnected = getIsConnected()
  if (!isConnected) {
    logger.log('[uploadScanner] not connected to indexer, skipping scan')
    return
  }
  logger.log('[uploadScanner] scanning...')
  try {
    const maxUploads = await getMaxUploads()
    const maxTotalUploads = SCANNER_MAX_TOTAL_UPLOADS_FACTOR * maxUploads
    const maxToAdd = SCANNER_ADD_TO_QUEUE_FACTOR * maxUploads
    if (getActiveUploads().length >= maxTotalUploads) {
      return
    }
    const localOnly = await getFilesLocalOnly()
    const activeUploads = getActiveUploads()
    const localFilesNotYetQueued = localOnly
      .filter((f) => !activeUploads.some((u) => u.id === f.id))
      .slice(0, maxToAdd)
    if (localFilesNotYetQueued.length > 0) {
      logger.log(
        `[uploadScanner] queuing ${localFilesNotYetQueued.length} uploads`,
        localFilesNotYetQueued.map((f) => f.id).join(', ')
      )
      localFilesNotYetQueued.forEach((f) => queueUploadForFileId(f.id))
    }
  } catch (e) {
    logger.log('[uploadScanner] scan error', e)
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
  const localOnly = useFileCountLocalOnly()
  const enabled = useAutoScanUploads()
  const activeUploads = useActiveUploads()
  const uploadedCount = total.data ?? 0 - (localOnly.data ?? 0)
  const isEnabled = enabled.data ?? false
  const localOnlyCount = localOnly.data ?? 0
  const activeProgress = activeUploads
    .map((u) => u.progress)
    .reduce((a, b) => a + b, 0)
  const percentComplete = localOnlyCount
    ? (activeProgress + uploadedCount) / localOnlyCount
    : 0

  return {
    show: isEnabled && !!localOnlyCount,
    enabled: isEnabled,
    remaining: localOnlyCount,
    percentComplete: `${percentComplete.toFixed(0)}%`,
    total: total.data ?? 0,
  }
}
