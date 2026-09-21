import type { DownloadLikeRef } from '@siastorage/core/adapters'
import type { DownloadObjectAdapter } from '@siastorage/core/app'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'

/**
 * Streams a pull-based download to a path.
 * Bounded memory: one chunk in flight at a time. Cleans up the partial file on error.
 */
async function streamToPath(
  dl: DownloadLikeRef,
  targetPath: string,
  totalSize: number | undefined,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  startAt = 0,
): Promise<number> {
  // A caller reads an extent's position from where its bytes sit, so a range
  // written at the front reads back as a file ending where the range does.
  const writeStream =
    startAt === 0
      ? createWriteStream(targetPath)
      : createWriteStream(targetPath, { flags: 'w+', start: startAt })
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
    // The SDK ends a stream and answers a cancelled download the same way,
    // with a read of nothing, so a short transfer would finalize as whole.
    if (!signal.aborted && typeof totalSize === 'number' && bytesWritten !== totalSize) {
      throw new Error(`Download ended at ${bytesWritten} of ${totalSize} bytes`)
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) =>
        err ? reject(err) : resolve(),
      )
    })
    onProgress(1)
    return bytesWritten
  } catch (e) {
    // The stream opens its file lazily, so an open still pending here would
    // land after the unlink below and recreate the file it just removed.
    // Closing first is what makes the unlink stick.
    writeStream.destroy()
    if (!writeStream.closed) {
      await new Promise<void>((resolve) => writeStream.once('close', () => resolve()))
    }
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
        offset: BigInt(0),
        length: undefined,
      })

      await deps.fsIO.ensureDirectory()
      await streamToPath(dl, deps.fsIO.uri(file.id, file.type), file.size, signal, onProgress)
    },

    async downloadRangeToPath({ object, sdk, destPath, offset, length, signal }) {
      const keyBytes = await deps.getAppKey(object.indexerURL)
      if (!keyBytes) throw new Error(`No AppKey found for indexer: ${object.indexerURL}`)

      const appKey = sdk.openAppKey(keyBytes)
      const pinnedObject = sdk.openPinnedObject(appKey, object)

      const dl = await sdk.download(pinnedObject, {
        offset: BigInt(offset),
        length: BigInt(length),
      })

      // createWriteStream follows a symlink at the destination and writes
      // through to its target, so the link is removed first. The managed-file
      // path in fsIO.exportTo unlinks for the same reason.
      await unlink(destPath).catch(() => {})
      // Written to the caller's path rather than into managed storage. A
      // range is not the file, and storing it there would make the next
      // reader see a partial file as fully downloaded.
      return streamToPath(dl, destPath, length, signal, () => {}, offset)
    },

    async downloadFromShareUrl({ file, url, sdk, ensureSpace, onProgress, signal }) {
      const sharedObject = await sdk.sharedObject(url)
      const totalSize = Number(sharedObject.size())
      await ensureSpace(totalSize)
      const dl = await sdk.download(sharedObject, {
        offset: BigInt(0),
        length: undefined,
      })

      await deps.fsIO.ensureDirectory()
      await streamToPath(dl, deps.fsIO.uri(file.id, file.type), totalSize, signal, onProgress)
    },
  }
}
