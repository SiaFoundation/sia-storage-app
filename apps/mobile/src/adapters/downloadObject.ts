import type { DownloadObjectAdapter } from '@siastorage/core/app'
import { DOWNLOAD_MAX_INFLIGHT } from '@siastorage/core/config'
import { PinnedObject } from 'react-native-sia'
import { streamToCache } from '../lib/streamToCache'
import { getAppKeyForIndexer } from '../stores/appKey'
import { copyFileToFs } from '../stores/fs'

export function createDownloadAdapter(): DownloadObjectAdapter {
  return {
    async download({ file, object, sdk, onProgress, signal }) {
      const appKey = await getAppKeyForIndexer(object.indexerURL)
      if (!appKey) throw new Error(`No AppKey found for indexer: ${object.indexerURL}`)

      const pinnedObject = PinnedObject.open(appKey, object)
      const dl = await sdk.download(pinnedObject, {
        maxInflight: DOWNLOAD_MAX_INFLIGHT,
        offset: BigInt(0),
        length: undefined,
      })

      await streamToCache({
        file,
        totalSize: file.size,
        dl,
        signal,
        onAfterClose: async (targetFile) => {
          await copyFileToFs(file, targetFile.uri)
        },
        onProgress,
      })
    },
  }
}
