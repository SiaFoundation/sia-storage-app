/**
 * The remote SDK for Node and Bun processes, which read upload files from disk
 * directly.
 */
import { readFile } from 'node:fs/promises'
import type { SdkAdapter } from '@siastorage/core/adapters'
import type { WireBlob } from '../protocol'
import { createRemoteSdk, parse } from './index'

export function createNodeRemoteSdk(options: { url: string; device: string }): SdkAdapter {
  return createRemoteSdk({
    ...options,
    async sendFile(path, blobsUrl, headers) {
      const res = await fetch(blobsUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(await readFile(path)),
      })
      return (await parse(res)) as WireBlob
    },
  })
}
