import type { DownloadObjectAdapter } from '@siastorage/core/app'
import { downloadToCache } from '../lib/downloadToCache'
import { app } from '../stores/appService'
import { adoptFileToFs } from '../stores/fs'

export function createDownloadAdapter(): DownloadObjectAdapter {
  return {
    async download({ file, object, sdk, onProgress, signal, maxBufferedChunks }) {
      const keyBytes = await app().auth.getAppKey(object.indexerURL)
      if (!keyBytes) throw new Error(`No AppKey found for indexer: ${object.indexerURL}`)

      const pinnedObject = sdk.openPinnedObject(sdk.openAppKey(keyBytes), object)
      const dl = await sdk.download(pinnedObject, {
        offset: BigInt(0),
        length: undefined,
        maxBufferedChunks,
      })

      await downloadToCache({
        file,
        totalSize: file.size,
        dl,
        signal,
        onProgress,
        onComplete: async (targetUri) => {
          await adoptFileToFs(file, targetUri)
        },
      })
    },
    async downloadFromShareUrl({ file, url, sdk, ensureSpace, onProgress, signal }) {
      const sharedObject = await sdk.objectFromShareUrl(url)
      const totalSize = Number(sharedObject.size())
      const maxBufferedChunks = await ensureSpace(totalSize)
      const dl = await sdk.download(sharedObject, {
        offset: BigInt(0),
        length: undefined,
        maxBufferedChunks,
      })

      await downloadToCache({
        file,
        totalSize,
        dl,
        signal,
        onProgress,
        onComplete: async (targetUri) => {
          await adoptFileToFs(file, targetUri)
        },
      })
    },
  }
}
