import type { DownloadLikeRef } from '@siastorage/core/adapters'
import { AbortError } from '@siastorage/core/lib/errors'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { getOrCreateTempDownloadFile, removeTempDownloadFile } from '../stores/tempFs'
import { fileUriToPath } from '@siastorage/core/lib/fileUri'

/** How often progress is read off the size of the file being written. */
const PROGRESS_POLL_MS = 500

/**
 * Downloads an object into a temp cache file and hands the finished file to
 * `onComplete`, which moves it into storage.
 *
 * The SDK writes the file itself with `writeToPath`, so no bytes cross into
 * JavaScript. Reading chunk by chunk handed each chunk over as an
 * `ArrayBuffer`, and the React Native binding never frees those, so a
 * download kept most of its size in memory the app could not get back.
 *
 * Progress is read off the size of the file as it grows rather than from the
 * SDK's shard callback. That callback fires about ten times per MiB and each
 * call waits its turn on the JavaScript thread, so a fast download outruns
 * its own progress reports. The SDK writes through a 4 MiB buffer, so the
 * size moves in steps of up to that much.
 *
 * A cancelled or failed download never reaches `onComplete`. Its partial
 * file is removed, since moving it into storage would mark the file as on
 * the device with only part of its bytes.
 */
export async function downloadToCache(params: {
  file: { id: string; type: string }
  /** Bytes the finished file must have. Null when only the SDK knows. */
  totalSize: number | null
  dl: DownloadLikeRef
  signal: AbortSignal
  onProgress: (progress: number) => void
  onComplete: (targetUri: string) => Promise<void>
}): Promise<void> {
  const { file, totalSize, dl, signal, onProgress, onComplete } = params
  if (!dl.writeToPath) throw new Error('This SDK cannot write a download to a file')
  const tempInfo = { ...file, localId: null, attempt: uniqueId() }
  const target = await getOrCreateTempDownloadFile(tempInfo)
  const path = fileUriToPath(target.uri)

  // A stat still in flight when the write ends would otherwise report a
  // lower figure after the download has finished.
  let writing = true
  const poll =
    totalSize && totalSize > 0
      ? setInterval(() => {
          RNFS.stat(path)
            .then((s) => {
              if (writing) onProgress(Math.min(1, s.size / totalSize))
            })
            .catch(() => {})
        }, PROGRESS_POLL_MS)
      : null

  try {
    let written: bigint
    try {
      written = await dl.writeToPath(path, { signal })
    } finally {
      writing = false
      if (poll) clearInterval(poll)
      // Aborting the call leaves the SDK's chunk tasks running and holding
      // their memory until the download itself is cancelled.
      await dl.cancel().catch(() => {})
    }
    if (signal.aborted) throw new AbortError()
    if (totalSize !== null && Number(written) !== totalSize) {
      throw new Error(`Download ended at ${written} of ${totalSize} bytes`)
    }
    logger.debug('downloadToCache', 'written', { fileId: file.id, bytes: Number(written) })
    await onComplete(target.uri)
  } catch (e) {
    await removeTempDownloadFile(tempInfo)
    throw signal.aborted ? new AbortError() : e
  }
}
