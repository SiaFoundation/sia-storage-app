import {
  TRANSFER_BUDGET_CEILING_BYTES,
  TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES,
  TRANSFER_BUDGET_FLOOR_BYTES,
  TRANSFER_BUDGET_UNREAD_BYTES,
  UPLOAD_MAX_SLABS,
} from '../config'
import { type MemoryReading, TransferMemoryBudget, uploadPeakBytes } from './transferMemoryBudget'

const MB = 1024 * 1024
const GB = 1024 * MB

function budget(reading: MemoryReading | null) {
  return new TransferMemoryBudget(() => reading)
}

describe('TransferMemoryBudget', () => {
  it('a platform with no reading gets the fixed budget, the most upload slabs and wide read-ahead', () => {
    const b = budget(null)
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_UNREAD_BYTES)
    expect(b.uploadSlabs()).toBe(UPLOAD_MAX_SLABS)
    expect(b.downloadChunks()).toBe(226)
  })

  it('a roomy Android phone is held to the ceiling, not to its free memory', () => {
    // A 12 GB phone with 5 GB free and Android's kill level at 300 MB.
    const b = budget({ availableBytes: 5 * GB, thresholdBytes: 300 * MB, lowMemory: false })
    expect(b.totalBytes()).toBe(TRANSFER_BUDGET_CEILING_BYTES)
    expect(b.uploadSlabs()).toBe(UPLOAD_MAX_SLABS)
    expect(b.downloadChunks()).toBe(226)
  })

  it('a phone between the ceiling and the floor buffers as many slabs as fit', () => {
    // 2772 MiB to spare, so a 693 MiB budget: 629 MiB beside the download floor
    // holds five slabs, three buffered plus the one waiting and the one filling.
    const b = budget({ availableBytes: 3 * GB, thresholdBytes: 300 * MB, lowMemory: false })
    expect(b.totalBytes()).toBe(693 * MB)
    expect(b.uploadSlabs()).toBe(3)
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
    let held = uploadPeakBytes(UPLOAD_MAX_SLABS)
    b.trackUploads(() => held)
    // 904 MiB less a five-slab upload's 840 MiB leaves the 64 MiB download floor, and half of it is 16 chunks.
    expect(b.downloadChunks()).toBe(16)
    held = 0
    expect(b.downloadChunks()).toBe(226)
  })

  it('a backup larger than the budget still leaves downloads the floor', () => {
    // 200 MiB budget, and a one-slab upload that peaks at 360 MiB.
    const b = budget({ availableBytes: 1200 * MB, thresholdBytes: 400 * MB, lowMemory: false })
    b.trackUploads(() => uploadPeakBytes(1))
    expect(b.downloadRoom()).toBe(TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES)
    expect(b.downloadChunks()).toBe(16)
  })

  it('an upload opened while another is still finishing counts the other one', () => {
    const b = budget(null)
    expect(b.uploadSlabs()).toBe(UPLOAD_MAX_SLABS)
    b.trackUploads(() => uploadPeakBytes(UPLOAD_MAX_SLABS))
    expect(b.uploadSlabs()).toBe(1)
  })

  it('each running download takes half of what is left, so many together stay within the budget', () => {
    const b = budget(null)
    const held = [b.reserveDownload(), b.reserveDownload(), b.reserveDownload()]
    expect(held.map((r) => r.chunks)).toEqual([226, 113, 56])
    // 395 chunks at 2 MiB each is 790 MiB of the 904 MiB budget.
    held[0].release()
    held[0].release()
    // Released once however often it is called: 566 MiB is left, half is 141 chunks.
    expect(b.downloadChunks()).toBe(141)
  })

  it('an upload opened beside running downloads buffers one slab when two would not fit', () => {
    const b = budget(null)
    b.reserveDownload()
    b.reserveDownload()
    // 678 MiB held by the downloads leaves 226 MiB, below a two-slab peak.
    expect(b.uploadSlabs()).toBe(1)
  })

  it('a tight budget makes uploads wait for a download the user asked for, not a background one', () => {
    // 200 MiB cannot hold a one-slab upload's 360 MiB beside the 64 MiB download floor.
    const b = budget({ availableBytes: 1200 * MB, thresholdBytes: 400 * MB, lowMemory: false })
    const thumbnail = b.reserveDownload()
    expect(b.uploadShouldWait()).toBe(false)
    const opened = b.reserveDownload({ user: true })
    expect(b.uploadShouldWait()).toBe(true)
    opened.release()
    expect(b.uploadShouldWait()).toBe(false)
    thumbnail.release()
  })

  it('a budget with room for a slab beside the download floor never makes uploads wait', () => {
    const b = budget(null)
    b.reserveDownload({ user: true })
    expect(b.uploadShouldWait()).toBe(false)
  })

  it('reads the device again for each transfer', () => {
    let free = 3 * GB
    const b = new TransferMemoryBudget(() => ({
      availableBytes: free,
      thresholdBytes: 0,
      lowMemory: false,
    }))
    expect(b.downloadChunks()).toBe(192)
    free = 400 * MB
    expect(b.downloadChunks()).toBe(25)
  })
})
