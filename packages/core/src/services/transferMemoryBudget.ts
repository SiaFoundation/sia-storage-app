import {
  DOWNLOAD_CHUNK_MEMORY_BYTES,
  DOWNLOAD_MIN_BUFFERED_CHUNKS,
  TRANSFER_BUDGET_CEILING_BYTES,
  TRANSFER_BUDGET_FLOOR_BYTES,
  TRANSFER_BUDGET_HEADROOM_SHARE,
  TRANSFER_BUDGET_UNREAD_BYTES,
  UPLOAD_SLAB_MEMORY_BYTES,
} from '../config'

/**
 * Decides how much memory uploads and downloads may hold, from what the
 * device says it can spare right now.
 *
 * Left to itself the SDK sizes every transfer from the device's total RAM, a
 * tenth of it each, and nothing limits several transfers together. On a
 * phone that lets one download's read-ahead grow past what the app can hold
 * without being stopped, and an upload buffer three to six 120 MiB slabs.
 *
 * The reading is taken each time a transfer starts, so it counts what
 * running transfers hold at that moment. A transfer keeps the allowance it
 * started with, since the SDK takes the figure once, when the transfer opens.
 * An upload fills its buffers over minutes, and a download widens its
 * read-ahead as it goes, so a reading taken early in either misses most of
 * what it will hold. So each transfer also counts what the others may hold
 * at most: the uploader reports its open uploads' peak, and each download
 * reserves its read-ahead until it ends. A download takes half of what is
 * left, so any number of them stay within the budget, short of the SDK's
 * eight-chunk floor.
 */

/** What the platform reports about memory right now. */
export type MemoryReading = {
  /** Memory the system says is still available. */
  availableBytes: number
  /**
   * The available-memory level at which the system starts stopping
   * background apps. Only memory above it can be spent. Zero where the
   * platform's figure is already what this app may spend.
   */
  thresholdBytes: number
  /** The system says it is already short of memory. */
  lowMemory: boolean
}

/** Supplied by the app. Null when the platform gives no reading. */
export type MemoryReader = () => MemoryReading | null

/** The most an upload buffering `slabs` holds: those, the filled slab waiting its turn, and the one filling. */
export function uploadPeakBytes(slabs: number): number {
  return (slabs + 2) * UPLOAD_SLAB_MEMORY_BYTES
}

export class TransferMemoryBudget {
  private read: MemoryReader
  private uploadHeld: () => number = () => 0
  private downloadsHeld = 0

  constructor(read: MemoryReader) {
    this.read = read
  }

  /** Called by the uploader with what its open uploads may peak at, zero with none open. */
  trackUploads(held: () => number): void {
    this.uploadHeld = held
  }

  /** Bytes all transfers may hold together. */
  totalBytes(): number {
    const reading = this.read()
    if (!reading) return TRANSFER_BUDGET_UNREAD_BYTES
    if (reading.lowMemory) return TRANSFER_BUDGET_FLOOR_BYTES
    const spendable = Math.max(0, reading.availableBytes - reading.thresholdBytes)
    const share = spendable * TRANSFER_BUDGET_HEADROOM_SHARE
    return Math.min(TRANSFER_BUDGET_CEILING_BYTES, Math.max(TRANSFER_BUDGET_FLOOR_BYTES, share))
  }

  /**
   * Slabs an upload may buffer. It peaks near 480 MiB at two and 360 MiB at
   * one, see `uploadPeakBytes`. With one, the next slab cannot
   * start uploading until the last is pinned, so two are used whenever the
   * budget covers that peak.
   */
  uploadSlabs(): number {
    return this.totalBytes() - this.downloadsHeld >= uploadPeakBytes(2) ? 2 : 1
  }

  /**
   * Read-ahead the next download may hold, in SDK chunks: half of what the
   * open uploads and running downloads leave of the budget, and never below
   * the eight chunks the SDK starts each download at. The SDK widens a
   * download past eight only while widening speeds it up, so this is a
   * ceiling a download reaches only on a connection that keeps paying.
   */
  downloadChunks(): number {
    const left = Math.max(0, this.totalBytes() - this.uploadHeld() - this.downloadsHeld)
    return Math.max(
      DOWNLOAD_MIN_BUFFERED_CHUNKS,
      Math.floor(left / 2 / DOWNLOAD_CHUNK_MEMORY_BYTES),
    )
  }

  /**
   * Takes `downloadChunks()` for a download about to open its stream and
   * holds it against later transfers until `release` is called, once.
   */
  reserveDownload(): { chunks: number; release: () => void } {
    const chunks = this.downloadChunks()
    const bytes = chunks * DOWNLOAD_CHUNK_MEMORY_BYTES
    this.downloadsHeld += bytes
    let released = false
    return {
      chunks,
      release: () => {
        if (released) return
        released = true
        this.downloadsHeld -= bytes
      },
    }
  }
}
