import type { DownloadLikeRef } from '@siastorage/core/adapters'
import type { DownloadObjectAdapter } from '@siastorage/core/app'
import { DOWNLOAD_MAX_INFLIGHT } from '@siastorage/core/config'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'

/**
 * Streams a pull-based download into the file backing `fsIO.uri(file.id, file.type)`.
 * Bounded memory: one chunk in flight at a time. Cleans up the partial file on error.
 */
async function streamToFs(
  dl: DownloadLikeRef,
  file: { id: string; type: string },
  totalSize: number | undefined,
  fsIO: FsIOAdapter,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<void> {
  await fsIO.ensureDirectory()
  const targetPath = fsIO.uri(file.id, file.type)
  const writeStream = createWriteStream(targetPath)
  let bytesWritten = 0

  try {
    while (true) {
      const chunk = await dl.read({ signal })
      if (chunk.byteLength === 0) break
      const buf = Buffer.from(chunk)
      // Backpressure: if the kernel buffer is full, wait for drain so we
      // don't accumulate chunks in JS memory faster than disk can absorb.
      if (!writeStream.write(buf)) {
        await new Promise<void>((resolve) => writeStream.once('drain', resolve))
      }
      bytesWritten += buf.byteLength
      if (typeof totalSize === 'number' && totalSize > 0) {
        onProgress(Math.min(1, bytesWritten / totalSize))
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) =>
        err ? reject(err) : resolve(),
      )
    })
    onProgress(1)
  } catch (e) {
    writeStream.destroy()
    await unlink(targetPath).catch(() => {})
    throw e
  } finally {
    await dl.cancel().catch(() => {})
  }
}

export function createNodeDownloadAdapter(deps: {
  fsIO: FsIOAdapter
  getAppKey: (indexerURL: string) => Promise<Uint8Array | null>
}): DownloadObjectAdapter {
  return {
    async download({ file, object, sdk, onProgress, signal }) {
      const keyBytes = await deps.getAppKey(object.indexerURL)
      if (!keyBytes) throw new Error(`No AppKey found for indexer: ${object.indexerURL}`)

      const appKey = sdk.openAppKey(keyBytes)
      const pinnedObject = sdk.openPinnedObject(appKey, object)

      const dl = await sdk.download(pinnedObject, {
        maxInflight: DOWNLOAD_MAX_INFLIGHT,
        offset: BigInt(0),
        length: undefined,
      })

      await streamToFs(dl, file, file.size, deps.fsIO, signal, onProgress)
    },

    async downloadFromShareUrl({ file, url, sdk, onProgress, signal }) {
      const sharedObject = await sdk.sharedObject(url)
      const dl = await sdk.download(sharedObject, {
        maxInflight: DOWNLOAD_MAX_INFLIGHT,
        offset: BigInt(0),
        length: undefined,
      })

      await streamToFs(dl, file, undefined, deps.fsIO, signal, onProgress)
    },
  }
}
