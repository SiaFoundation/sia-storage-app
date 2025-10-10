import { SlotPool } from '../lib/slotPool'
import { getKey, triggerChange } from '../stores/settings'
import { SingleInit } from '../lib/singleflight'
import {
  setSecureStoreNumber,
  getSecureStoreNumber,
} from '../stores/secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { logger } from '../lib/logger'
import { DEFAULT_MAX_DOWNLOADS } from '../config'

let downloadPool: SlotPool | null = null
const initDownloadOnce = new SingleInit()

async function getDownloadPool(): Promise<SlotPool> {
  if (downloadPool) return downloadPool
  return initDownloadOnce.run(async () => {
    if (!downloadPool) {
      const maxSlots = await getMaxDownloads()
      downloadPool = new SlotPool(maxSlots)
    }
    return downloadPool
  })
}

export async function setDownloadMaxSlots(maxSlots: number): Promise<void> {
  const pool = await getDownloadPool()
  pool.setMaxSlots(maxSlots)
}

export async function acquireDownloadSlot(): Promise<() => void> {
  const pool = await getDownloadPool()
  return pool.acquire()
}

// Max Downloads setting

export async function setMaxDownloads(value: number) {
  if (!value) {
    logger.log('[settings] setMaxDownloads: value must be 1 or greater')
  }
  const clamped = Math.max(1, Math.floor(Number(value) || 1))
  await setSecureStoreNumber('maxDownloads', clamped)
  setDownloadMaxSlots(clamped)
  triggerChange('maxDownloads')
}

export const [getMaxDownloads, useMaxDownloads] = createGetterAndSWRHook(
  getKey('maxDownloads'),
  () => getSecureStoreNumber('maxDownloads', DEFAULT_MAX_DOWNLOADS)
)
