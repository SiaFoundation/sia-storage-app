import type { DownloadObjectAdapter } from '@siastorage/core/app'
import { streamToCache } from '../lib/streamToCache'
import { app } from '../stores/appService'
import { adoptFileToFs } from '../stores/fs'

export function createDownloadAdapter(): DownloadObjectAdapter {
  return {
    async download({ file, object, sdk, onProgress, signal }) {
      const keyBytes = await app().auth.getAppKey(object.indexerURL)
      if (!keyBytes) throw new Error(`No AppKey found for indexer: ${object.indexerURL}`)

      const pinnedObject = sdk.openPinnedObject(sdk.openAppKey(keyBytes), object)
      const dl = await sdk.download(pinnedObject, {
        offset: BigInt(0),
        length: undefined,
      })

      await streamToCache({
        file,
        totalSize: file.size,
        dl,
        signal,
        onAfterClose: async (targetFile) => {
          await adoptFileToFs(file, targetFile.uri)
        },
        onProgress,
      })
    },
    async downloadFromShareUrl({ file, url, sdk, ensureSpace, onProgress, signal }) {
      const sharedObject = await sdk.sharedObject(url)
      const totalSize = Number(sharedObject.size())
      await ensureSpace(totalSize)
      const dl = await sdk.download(sharedObject, {
        offset: BigInt(0),
        length: undefined,
      })

      await streamToCache({
        file,
        totalSize,
        dl,
        signal,
        onAfterClose: async (targetFile) => {
          await adoptFileToFs(file, targetFile.uri)
        },
        onProgress,
      })
    },
  }
}
