import { SlotPool } from '../lib/slotPool'

/** Global shared pool used across uploads and downloads. */
const globalSlotPool = new SlotPool(5)

/** Returns the global shared `SlotPool`. */
export function getGlobalSlotPool(): SlotPool {
  return globalSlotPool
}

/** Sets the maximum slots on the global pool. */
export function setGlobalMaxSlots(maxSlots: number): void {
  globalSlotPool.setMaxSlots(maxSlots)
}
