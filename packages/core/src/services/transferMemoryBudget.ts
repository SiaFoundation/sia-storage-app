import {
  DOWNLOAD_CHUNK_MEMORY_BYTES,
  DOWNLOAD_MIN_BUFFERED_CHUNKS,
  TRANSFER_BUDGET_CEILING_BYTES,
  TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES,
  TRANSFER_BUDGET_FLOOR_BYTES,
  TRANSFER_BUDGET_HEADROOM_SHARE,
  TRANSFER_BUDGET_UNREAD_BYTES,
  UPLOAD_MAX_SLABS,
  UPLOAD_SLAB_MEMORY_BYTES,
} from '../config'

/**
 * Decides how much memory uploads and downloads may hold, from what the
 * device says it can spare right now.
 *
 * Left to itself the SDK sizes every transfer from the device's total RAM, a
 * tenth of it each, and nothing limits several transfers together. On a
 * phone that lets one download's read-ahead grow past what the app can hold
 * without being stopped.
 *
 * Memory goes to what is in flight, never to a file's size. An upload holds
 * whole slabs, 120 MiB each, however large the file, and a download holds its
 * read-ahead window. The reading is taken each time a transfer starts, and a
 * transfer keeps the allowance it started with, since the SDK takes the
 * figure once, when the transfer opens. So each transfer also counts what the
 * others may hold at most: the uploader reports its open uploads' peak, and
 * each download reserves its read-ahead until it ends.
 *
 * Downloads keep `TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES` whatever uploads hold,
 * and uploads size themselves from the rest. An upload needs at least one
 * slab, so where the budget cannot hold one beside that floor, the uploader
 * waits between files while a download the user asked for runs, and a lone
 * upload's one slab is allowed past the budget.
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
  private userDownloads = 0

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
   * Slabs a new upload may buffer: as many as fit, up to `UPLOAD_MAX_SLABS`,
   * in what the download floor, running downloads and every other open upload
   * leave, and never fewer than one. With one, the next slab cannot start
   * uploading until the last is pinned.
   */
  uploadSlabs(): number {
    const downloads = Math.max(this.downloadsHeld, TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES)
    const room = this.totalBytes() - downloads - this.uploadHeld()
    // uploadPeakBytes counts two slabs beyond those buffered.
    const fit = Math.floor(room / UPLOAD_SLAB_MEMORY_BYTES) - 2
    return Math.min(UPLOAD_MAX_SLABS, Math.max(1, fit))
  }

  /** What downloads may hold together: what open uploads leave, and never less than the download floor. */
  downloadRoom(): number {
    return Math.max(this.totalBytes() - this.uploadHeld(), TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES)
  }

  /**
   * Read-ahead the next download may hold, in SDK chunks: half of the
   * download room running downloads leave, and never below the eight chunks
   * the SDK starts each download at. The SDK widens a download past eight
   * only while that speeds it up, so this is a ceiling.
   */
  downloadChunks(): number {
    const left = Math.max(0, this.downloadRoom() - this.downloadsHeld)
    return Math.max(
      DOWNLOAD_MIN_BUFFERED_CHUNKS,
      Math.floor(left / 2 / DOWNLOAD_CHUNK_MEMORY_BYTES),
    )
  }

  /**
   * Whether the uploader should hold off adding its next file: a download the
   * user asked for is running, and the budget cannot hold one upload slab
   * beside the download floor.
   */
  uploadShouldWait(): boolean {
    return (
      this.userDownloads > 0 &&
      this.totalBytes() - TRANSFER_BUDGET_DOWNLOAD_FLOOR_BYTES < uploadPeakBytes(1)
    )
  }

  /**
   * Takes `downloadChunks()` for a download about to open its stream and
   * holds it against later transfers until `release` is called, once. A
   * `user` download also asks uploads to wait while the budget is tight.
   */
  reserveDownload(opts: { user?: boolean } = {}): { chunks: number; release: () => void } {
    const chunks = this.downloadChunks()
    const bytes = chunks * DOWNLOAD_CHUNK_MEMORY_BYTES
    this.downloadsHeld += bytes
    if (opts.user) this.userDownloads += 1
    let released = false
    return {
      chunks,
      release: () => {
        if (released) return
        released = true
        this.downloadsHeld -= bytes
        if (opts.user) this.userDownloads -= 1
      },
    }
  }
}
