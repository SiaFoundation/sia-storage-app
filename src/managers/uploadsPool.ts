import { SlotPool } from '../lib/slotPool'
import { getKey, triggerChange } from '../stores/settings'
import { SingleInit } from '../lib/singleflight'
import { logger } from '../lib/logger'
import {
  getSecureStoreNumber,
  setSecureStoreNumber,
} from '../stores/secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { DEFAULT_MAX_UPLOADS } from '../config'

let uploadPool: SlotPool | null = null
const initUploadOnce = new SingleInit()

async function getUploadPool(): Promise<SlotPool> {
  if (uploadPool) return uploadPool
  return initUploadOnce.run(async () => {
    if (!uploadPool) {
      const maxSlots = await getMaxUploads()
      uploadPool = new SlotPool(maxSlots)
    }
    return uploadPool
  })
}

export async function setUploadMaxSlots(maxSlots: number): Promise<void> {
  const pool = await getUploadPool()
  pool.setMaxSlots(maxSlots)
}

export async function acquireUploadSlot(): Promise<() => void> {
  const pool = await getUploadPool()
  return pool.acquire()
}

// Max Uploads setting

export async function setMaxUploads(value: number) {
  if (!value) {
    logger.log('[settings] setMaxUploads: value must be 1 or greater')
  }
  const clamped = Math.max(1, Math.floor(Number(value) || 1))
  await setSecureStoreNumber('maxUploads', clamped)
  setUploadMaxSlots(clamped)
  triggerChange('maxUploads')
}

export const [getMaxUploads, useMaxUploads] = createGetterAndSWRHook(
  getKey('maxUploads'),
  () => getSecureStoreNumber('maxUploads', DEFAULT_MAX_UPLOADS)
)
