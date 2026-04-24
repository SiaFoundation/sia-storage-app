import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter } from '../../adapters/sdk'
import { DOWNLOAD_MAX_INFLIGHT } from '../../config'
import * as ops from '../../db/operations'
import { sealPinnedObject } from '../../lib/localObjects'
import type { AppService } from '../service'

export function buildSharesNamespace(
  db: DatabaseAdapter,
  getSdk: () => SdkAdapter | null,
  getIndexerURL: () => Promise<string>,
  getAppKeyBytes: (indexerURL: string) => Promise<Uint8Array | null>,
): AppService['shares'] {
  function requireSdk(): SdkAdapter {
    const sdk = getSdk()
    if (!sdk) throw new Error('SDK not initialized')
    return sdk
  }

  async function loadAppKey(sdk: SdkAdapter, indexerURL: string) {
    const bytes = await getAppKeyBytes(indexerURL)
    if (!bytes) throw new Error(`No AppKey found for indexer: ${indexerURL}`)
    return sdk.openAppKey(bytes)
  }

  return {
    getMetadata: async (url) => {
      const sdk = requireSdk()
      const obj = await sdk.sharedObject(url)
      return { size: Number(obj.size()) }
    },

    downloadFirstBytes: async (url, byteCount) => {
      const sdk = requireSdk()
      const obj = await sdk.sharedObject(url)
      const dl = await sdk.download(obj, {
        maxInflight: DOWNLOAD_MAX_INFLIGHT,
        offset: BigInt(0),
        length: BigInt(byteCount),
      })
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        while (total < byteCount) {
          const chunk = await dl.read()
          if (chunk.byteLength === 0) break
          const buf = new Uint8Array(chunk)
          chunks.push(buf)
          total += buf.length
        }
      } finally {
        await dl.cancel().catch(() => {})
      }
      const out = new Uint8Array(Math.min(total, byteCount))
      let offset = 0
      for (const chunk of chunks) {
        const n = Math.min(chunk.length, byteCount - offset)
        out.set(chunk.slice(0, n), offset)
        offset += n
        if (offset >= byteCount) break
      }
      return out
    },

    pin: async (url, fileId) => {
      const sdk = requireSdk()
      const indexerURL = await getIndexerURL()
      const appKey = await loadAppKey(sdk, indexerURL)
      const obj = await sdk.sharedObject(url)
      await sdk.pinObject(obj)
      return sealPinnedObject(fileId, indexerURL, obj, appKey)
    },

    create: async (fileId, validUntil) => {
      const sdk = requireSdk()
      const objects = await ops.queryObjectsForFile(db, fileId)
      if (objects.length === 0) throw new Error('No local object for file')
      const object = objects[0]
      const appKey = await loadAppKey(sdk, object.indexerURL)
      const pinned = sdk.openPinnedObject(appKey, object)
      return sdk.shareObject(pinned, validUntil)
    },
  }
}
