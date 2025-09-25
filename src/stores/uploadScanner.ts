import { create } from 'zustand'
import { getSecureStoreBoolean, setSecureStoreBoolean } from './secureStore'
import { logger } from '../lib/logger'
import { getActiveUploads, getInflightCounts } from './transfers'
import {
  getFilesLocalOnly,
  useFileCountAll,
  useFileCountLocalOnly,
} from './files'
import { queueUploadForFileId } from '../managers/uploader'

type UploadScannerState = {
  autoScanUploads: boolean
  setAutoScanUploads: (value: boolean) => Promise<void>
  initUploadScanner: () => Promise<void>
}

const MAX_BACKGROUND_UPLOADS = 5
const SECURE_STORE_AUTO_SCAN_KEY = 'uploadScanner/autoScan'

let scanTimer: NodeJS.Timeout | null = null

function startScanner(): void {
  if (scanTimer) return
  logger.log('[uploadScanner] starting scanner')
  const scan = async () => {
    try {
      if (getInflightCounts().total >= MAX_BACKGROUND_UPLOADS) {
        return
      }
      const localOnly = await getFilesLocalOnly()
      const activeUploads = getActiveUploads()
      const localFilesNotYetQueued = localOnly.filter(
        (f) => !activeUploads.some((u) => u.id === f.id)
      )
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
  scanTimer = setInterval(scan, 5_000)
}

function stopScanner(): void {
  if (!scanTimer) return
  logger.log('[uploadScanner] stopping scanner')
  clearInterval(scanTimer)
  scanTimer = null
}

export const useUploadScannerStore = create<UploadScannerState>((set, get) => ({
  autoScanUploads: true,
  setAutoScanUploads: async (value: boolean) => {
    set({ autoScanUploads: value })
    await setSecureStoreBoolean(SECURE_STORE_AUTO_SCAN_KEY, value)
    logger.log(`[uploadScanner] autoScanUploads set to ${value}`)
    if (value) startScanner()
    else stopScanner()
  },
  initUploadScanner: async () => {
    const saved = await getSecureStoreBoolean(SECURE_STORE_AUTO_SCAN_KEY)
    const enabled = saved === true
    set({ autoScanUploads: enabled })
    logger.log(`[uploadScanner] init: autoScanUploads=${enabled}`)
    if (enabled) startScanner()
  },
}))

export function useAutoScanUploads(): boolean {
  return useUploadScannerStore((s) => s.autoScanUploads)
}

export function useUploadScannerStatus(): {
  enabled: boolean
  localOnly: number
  remaining: number
  total: number
} {
  const total = useFileCountAll()
  const localOnly = useFileCountLocalOnly()
  const enabled = useAutoScanUploads()
  return {
    enabled,
    localOnly: localOnly.data ?? 0,
    remaining: (total.data ?? 0) - (localOnly.data ?? 0),
    total: total.data ?? 0,
  }
}

export function initUploadScanner() {
  return useUploadScannerStore.getState().initUploadScanner()
}

export function setAutoScanUploads(value: boolean) {
  return useUploadScannerStore.getState().setAutoScanUploads(value)
}
