import { SlotPool } from '../lib/slotPool'
import { getMaxTransfers } from '../stores/settings'
import { SingleInit } from '../lib/singleflight'

/** Transfers pool used across uploads and downloads. */
let transfersPool: SlotPool | null = null
const initOnce = new SingleInit()

/** Returns the transfers `SlotPool`. */
export async function getTransfersPool(): Promise<SlotPool> {
  if (transfersPool) return transfersPool
  return initOnce.run(async () => {
    if (!transfersPool) {
      const maxSlots = await getMaxTransfers()
      transfersPool = new SlotPool(maxSlots)
    }
    return transfersPool
  })
}

/** Sets the maximum slots on the transfers pool. */
export async function setTransfersMaxSlots(maxSlots: number): Promise<void> {
  const pool = await getTransfersPool()
  pool.setMaxSlots(maxSlots)
}

/** Acquires a slot from the transfers pool. */
export async function acquireTransfersSlot(): Promise<() => void> {
  const pool = await getTransfersPool()
  return pool.acquire()
}
