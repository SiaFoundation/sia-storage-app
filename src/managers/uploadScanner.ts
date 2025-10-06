import { logger } from '../lib/logger'
import { getActiveUploads, getTransferCounts } from '../stores/transfers'
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
import { useAuthStore } from '../stores/auth'
import {
  getAutoScanUploads,
  getMaxTransfers,
  setAutoScanUploads,
  useAutoScanUploads,
} from '../stores/settings'

let scanTimer: NodeJS.Timeout | null = null

function startUploadScanner(): void {
  if (scanTimer) return
  logger.log('[uploadScanner] starting scanner')
  const scan = async () => {
    logger.log('[uploadScanner] scanning...')
    try {
      const maxTransfers = await getMaxTransfers()
      const maxTotalUploads = SCANNER_MAX_TOTAL_UPLOADS_FACTOR * maxTransfers
      const maxToAdd = SCANNER_ADD_TO_QUEUE_FACTOR * maxTransfers
      if (!useAuthStore.getState().isConnected) return
      if (getTransferCounts().total >= maxTotalUploads) {
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
  scanTimer = setInterval(scan, SCANNER_INTERVAL)
}

export function stopUploadScanner(): void {
  if (!scanTimer) return
  logger.log('[uploadScanner] stopping scanner')
  clearInterval(scanTimer)
  scanTimer = null
}

export async function toggleUploadScanner() {
  const current = await getAutoScanUploads()
  const next = !current
  await setAutoScanUploads(next)
  logger.log(`[uploadScanner] autoScanUploads set to ${next}`)
  if (next) startUploadScanner()
  else stopUploadScanner()
}

export async function initUploadScanner() {
  const autoScanUploads = await getAutoScanUploads()
  logger.log(`[uploadScanner] init: autoScanUploads=${autoScanUploads}`)
  if (autoScanUploads) startUploadScanner()
}

export function useUploadScannerStatus(): {
  enabled: boolean
  remaining: number
  percentComplete: string
  total: number
} {
  const total = useFileCountAll()
  const localOnly = useFileCountLocalOnly()
  const enabled = useAutoScanUploads()
  const percentComplete =
    (((total.data ?? 0) - (localOnly.data ?? 0)) / (total.data ?? 0)) * 100
  return {
    enabled: enabled.data ?? false,
    remaining: localOnly.data ?? 0,
    percentComplete: `${percentComplete.toFixed(0)}%`,
    total: total.data ?? 0,
  }
}
