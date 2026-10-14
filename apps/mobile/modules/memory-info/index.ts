import { requireOptionalNativeModule } from 'expo'

/** What the platform reports about memory pressure right now. */
export type MemoryReading = {
  /** Memory the system says is still available. */
  availableBytes: number
  /**
   * The available-memory level at which the system starts killing background
   * processes. Headroom is `availableBytes` above this, not `availableBytes`.
   * Zero where the platform reports a per-process figure that is already
   * headroom.
   */
  thresholdBytes: number
  /** The system is already reclaiming. */
  lowMemory: boolean
}

type NativeModule = {
  read(): MemoryReading | null
}

const native = requireOptionalNativeModule<NativeModule>('MemoryInfo')

/**
 * Reads how much memory the system can spare, or null when it gives no
 * reading. Transfers then take a fixed budget, since a reading that failed
 * must not stop a transfer from starting.
 */
export function readMemory(): MemoryReading | null {
  if (!native) return null
  try {
    return native.read()
  } catch {
    return null
  }
}
