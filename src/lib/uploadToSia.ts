import { Sdk } from 'react-native-sia'

export type UploadProgress = {
  bytesWritten: number
  totalBytes: number
  percent: number // 0..1
}

export async function uploadToSia(params: {
  sdk: Sdk
  encryptionKey: ArrayBuffer
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  signal?: AbortSignal
  onProgress?: (p: UploadProgress) => void
}): Promise<void> {
  const {
    sdk,
    encryptionKey,
    dataShards = 10,
    parityShards = 30,
    data,
    signal,
    onProgress,
  } = params

  const upload = await sdk.upload(encryptionKey, dataShards, parityShards)

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  while (offset < total) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + chunkSize, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    offset = end
    onProgress?.({
      bytesWritten: offset,
      totalBytes: total,
      percent: offset / total,
    })
  }

  if (signal) {
    await upload.finalize({ signal })
  } else {
    await upload.finalize()
  }
}
