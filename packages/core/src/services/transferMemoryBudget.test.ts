import {
  TRANSFER_BUDGET_CEILING_BYTES,
  TRANSFER_BUDGET_FLOOR_BYTES,
  TRANSFER_BUDGET_UNREAD_BYTES,
} from '../config'
import { type MemoryReading, TransferMemoryBudget, uploadPeakBytes } from './transferMemoryBudget'

const MB = 1024 * 1024
const GB = 1024 * MB

function budget(reading: MemoryReading | null) {
  return new TransferMemoryBudget(() => reading)
}

describe('TransferMemoryBudget', () => {
  it('a platform with no reading gets the fixed budget, two upload slabs and wide read-ahead', () => {
    const b = budget(null)
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_UNREAD_BYTES)
    expect(b.uploadSlabs()).toBe(2)
    expect(b.downloadChunks()).toBe(128)
  })

  it('a roomy Android phone is held to the ceiling, not to its free memory', () => {
    // A 12 GB phone with 3 GB free and Android's kill level at 300 MB.
    const b = budget({ availableBytes: 3 * GB, thresholdBytes: 300 * MB, lowMemory: false })
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_CEILING_BYTES)
    expect(b.uploadSlabs()).toBe(2)
    expect(b.downloadChunks()).toBe(128)
  })

  it('a phone with less to spare gets a quarter of it, one upload slab and narrower read-ahead', () => {
    // 800 MB above the kill level.
    const b = budget({ availableBytes: 1200 * MB, thresholdBytes: 400 * MB, lowMemory: false })
    expect(b.totalBytes()).toBe(200 * MB)
    expect(b.uploadSlabs()).toBe(1)
    expect(b.downloadChunks()).toBe(50)
  })

  it('a phone that says it is short of memory gets the floor', () => {
    const b = budget({ availableBytes: 3 * GB, thresholdBytes: 300 * MB, lowMemory: true })
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_FLOOR_BYTES)
    expect(b.uploadSlabs()).toBe(1)
    expect(b.downloadChunks()).toBe(16)
  })

  it('available memory below the kill level counts as none to spare, not as negative', () => {
    const b = budget({ availableBytes: 200 * MB, thresholdBytes: 300 * MB, lowMemory: false })
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_FLOOR_BYTES)
  })

  it('an iPhone reading, which is already what the app may spend, is taken as it is', () => {
    const b = budget({ availableBytes: 1600 * MB, thresholdBytes: 0, lowMemory: false })
    expect(b.totalBytes()).toBe(400 * MB)
    expect(b.uploadSlabs()).toBe(1)
    expect(b.downloadChunks()).toBe(100)
  })

  it('downloads size against what an open upload leaves, and get it all back once it closes', () => {
    const b = budget(null)
    let held = uploadPeakBytes(2)
    b.trackUploads(() => held)
    // 512 MiB less 480 MiB leaves 16 MiB a download, below the SDK's floor of eight.
    expect(b.downloadChunks()).toBe(8)
    held = 0
    expect(b.downloadChunks()).toBe(128)
  })

  it('each running download takes half of what is left, so many together stay within the budget', () => {
    const b = budget(null)
    const held = [b.reserveDownload(), b.reserveDownload(), b.reserveDownload()]
    expect(held.map((r) => r.chunks)).toEqual([128, 64, 32])
    // 224 chunks at 2 MiB each is 448 MiB of the 512 MiB budget.
    held[0].release()
    held[0].release()
    // Released once however often it is called: 320 MiB is left, half is 80 chunks.
    expect(b.downloadChunks()).toBe(80)
  })

  it('an upload opened beside running downloads buffers one slab when two would not fit', () => {
    const b = budget(null)
    b.reserveDownload()
    b.reserveDownload()
    // 384 MiB held by the downloads leaves 128 MiB, below a two-slab peak.
    expect(b.uploadSlabs()).toBe(1)
  })

  it('reads the device again for each transfer', () => {
    let free = 3 * GB
    const b = new TransferMemoryBudget(() => ({
      availableBytes: free,
      thresholdBytes: 0,
      lowMemory: false,
    }))
    expect(b.downloadChunks()).toBe(128)
    free = 400 * MB
    expect(b.downloadChunks()).toBe(25)
  })
})
