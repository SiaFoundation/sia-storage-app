import { uniqueId } from '@siastorage/core/lib/uniqueId'
import {
  addCopyProgressListener,
  cancelCopy,
  copyAsset,
  copyToPath,
  type CopyProgressEvent,
} from 'import-sources'
import { type ContentHash, toContentHash } from '@siastorage/core/lib/contentHash'

type ProgressCallback = (bytesCopied: number, totalBytes: number | null) => void

// One module-level subscription dispatching by copyId; subscribing and
// unsubscribing per copy would churn listeners across the bridge.
const progressCallbacks = new Map<string, ProgressCallback>()
let subscribed = false

function ensureSubscription(): void {
  if (subscribed) return
  subscribed = true
  addCopyProgressListener((event: CopyProgressEvent) => {
    progressCallbacks.get(event.copyId)?.(event.bytesCopied, event.totalBytes)
  })
}

/**
 * Copies one import source, reading it exactly once to produce the file, its
 * sha256, and the classification inputs. `asset://<id>` routes to the
 * photo-library reader, which reports the copied resource's OS type as
 * `mediaMime`; every other uri streams through copyToPath, which returns the
 * file's first bytes as `headerBytes`. Classifying is the caller's job.
 *
 * An AbortSignal maps to the native cancelCopy rather than abandoning the
 * promise, so a cancelled tick stops the work instead of leaving it running
 * against a destination the scanner has already given up on.
 */
export async function copyImportFile(
  srcUri: string,
  destPath: string,
  opts: { signal?: AbortSignal; onProgress?: ProgressCallback } = {},
): Promise<
  | { kind: 'stream'; size: number; sha256: ContentHash; headerBytes?: Uint8Array }
  | { kind: 'asset'; size: number; sha256: ContentHash; mediaMime: string }
> {
  if (opts.signal?.aborted) {
    // Never start native work for an already-dead tick.
    const e = new Error('copy cancelled before start') as Error & { code: string }
    e.code = 'cancelled'
    throw e
  }
  const copyId = uniqueId()
  if (opts.onProgress) {
    ensureSubscription()
    progressCallbacks.set(copyId, opts.onProgress)
  }
  const onAbort = () => {
    void cancelCopy(copyId)
  }
  opts.signal?.addEventListener('abort', onAbort)
  try {
    if (srcUri.startsWith('asset://')) {
      const { mime, sha256, ...rest } = await copyAsset(srcUri.slice('asset://'.length), destPath, {
        copyId,
      })
      return { kind: 'asset', ...rest, sha256: toContentHash(sha256), mediaMime: mime }
    }
    const { sha256, ...rest } = await copyToPath(srcUri, destPath, { copyId })
    return { kind: 'stream', ...rest, sha256: toContentHash(sha256) }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    progressCallbacks.delete(copyId)
  }
}
