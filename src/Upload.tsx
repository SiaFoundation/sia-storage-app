import * as ImagePicker from 'react-native-image-picker'
import { uploadToSia } from './lib/uploadToSia'
import { Sdk } from 'react-native-sia'

const appSeed = new Uint8Array(32).fill(1)

// Types for the new upload workflow used by the Feed screen.
export type UploadedItem = {
  id: string
  uri: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  status: 'uploading' | 'done' | 'error'
  progress?: number
}

// Helper: Pick multiple images and upload all of them. Returns final items.
export async function pickAndUploadImages({
  sdk,
  log,
  onProgress,
  onPicked,
}: {
  sdk: Sdk
  log: (message: string) => void
  onProgress?: (id: string, progress: number) => void
  onPicked?: (items: UploadedItem[]) => void
}): Promise<UploadedItem[]> {
  try {
    const result = await ImagePicker.launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 0, // 0 => unlimited on iOS; Android uses picker default multi-select UI if available.
      includeExtra: true,
      includeBase64: true,
    })

    if (result.didCancel) {
      log('Image selection canceled.')
      return []
    }
    if (result.errorCode) {
      log(`Image picker error: ${result.errorMessage ?? result.errorCode}`)
      return []
    }

    const assets: ImagePicker.Asset[] = (result.assets ?? []).filter(
      (a): a is ImagePicker.Asset => Boolean(a && a.uri)
    )

    if (assets.length === 0) {
      log('No images selected.')
      return []
    }

    // Emit optimistic items immediately.
    const tempItems: UploadedItem[] = assets.map((asset) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      uri: asset.uri as string,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize ?? null,
      createdAt: Date.now(),
      status: 'uploading',
    }))
    onPicked?.(tempItems)

    const readArrayBuffer = async (
      asset: ImagePicker.Asset
    ): Promise<ArrayBuffer> => {
      if (asset.base64) {
        const res = await fetch(
          `data:application/octet-stream;base64,${asset.base64}`
        )
        return await res.arrayBuffer()
      }
      const response = await fetch(asset.uri as string)
      return await response.arrayBuffer()
    }

    // Upload with limited concurrency to avoid overwhelming the device/network.
    const CONCURRENCY_LIMIT = 5
    type AssetTempPair = { asset: ImagePicker.Asset; tempItem: UploadedItem }
    const pairs: AssetTempPair[] = assets
      .map((asset, idx) => ({ asset, tempItem: tempItems[idx] }))
      .filter((p): p is AssetTempPair => Boolean(p.tempItem))
    const finalItems: UploadedItem[] = new Array(pairs.length)

    let nextIndex = 0
    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex
        nextIndex += 1
        if (currentIndex >= pairs.length) return

        const pair: AssetTempPair | undefined = pairs[currentIndex]
        if (!pair) {
          continue
        }
        const { asset, tempItem } = pair
        try {
          const buffer = await readArrayBuffer(asset)
          await uploadToSia({
            sdk,
            encryptionKey: appSeed.buffer,
            data: buffer,
            onProgress: (p) => onProgress?.(tempItem.id, p.percent),
          })
          const done: UploadedItem = {
            ...tempItem,
            status: 'done',
            progress: 1,
          }
          finalItems[currentIndex] = done
        } catch (e) {
          log(`Upload flow error: ${String(e)}`)
          const errored: UploadedItem = {
            ...tempItem,
            status: 'error',
          }
          finalItems[currentIndex] = errored
        }
      }
    }

    const workerCount = Math.min(CONCURRENCY_LIMIT, pairs.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    return finalItems
  } catch (e) {
    log(`Upload flow error: ${String(e)}`)
    return []
  }
}
