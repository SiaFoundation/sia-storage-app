// Stub for the native `memory-info` module. Reading system memory is a platform
// call that can't run under jest, and returning null is the real module's own
// answer when a reading is unavailable, so transfers fall back to their fixed
// budget. The budget arithmetic itself is covered in core.
export type MemoryReading = {
  availableBytes: number
  thresholdBytes: number
  lowMemory: boolean
}

export function readMemory(): MemoryReading | null {
  return null
}
