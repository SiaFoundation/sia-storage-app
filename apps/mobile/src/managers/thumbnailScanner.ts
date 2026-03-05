import { THUMBNAIL_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ThumbnailScanner,
  type ThumbnailScannerResult,
} from '@siastorage/core/services/thumbnailScanner'
import { Directory, File, Paths } from 'expo-file-system'
import QuickCrypto from 'react-native-quick-crypto'
import { createMobileThumbnailAdapter } from '../adapters/thumbnail'
import { db } from '../db'
import { detectMimeType } from '../lib/detectMimeType'
import { getMimeType } from '../lib/fileTypes'
import { copyFileToFs, getFsFileUri } from '../stores/fs'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'
import { invalidateThumbnailsForFileId } from '../stores/thumbnails'

export type {
  ProducedThumbnail,
  ThumbnailAttempt,
  ThumbnailGenerationError,
  ThumbnailScannerResult,
} from '@siastorage/core/services/thumbnailScanner'

const scanner = new ThumbnailScanner()

export function getThumbnailScanner(): ThumbnailScanner {
  ensureInitialized()
  return scanner
}

function ensureInitialized(): void {
  if (scanner.isInitialized()) return
  scanner.initialize({
    db: db(),
    thumbnailAdapter: createMobileThumbnailAdapter(),
    cryptoAdapter: {
      async sha256(data: ArrayBuffer): Promise<string> {
        const h = QuickCrypto.createHash('sha256')
        h.update(data)
        return h.digest('hex')
      },
    },
    detectMimeType: (path: string) => detectMimeType(path),
    getFsFileUri: (file) => getFsFileUri(file),
    async copyToFs(file, data) {
      const type = await getMimeType({
        type: file.type,
        name: 'thumbnail.webp',
      })
      const tmpPath = `${file.id}.webp`
      const tmpDir = new Directory(Paths.cache, 'thumb-tmp')
      const tmpDirInfo = tmpDir.info()
      if (!tmpDirInfo.exists) tmpDir.create({ intermediates: true })
      const tmpFile = new File(tmpDir, tmpPath)
      tmpFile.write(new Uint8Array(data))
      const uri = await copyFileToFs({ id: file.id, type }, tmpFile)
      const info = new File(uri).info()
      return { uri, size: info.size ?? data.byteLength }
    },
    async invalidateCache(fileId) {
      invalidateThumbnailsForFileId(fileId)
      await invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    },
  })
}

export async function runThumbnailScanner(
  signal?: AbortSignal,
): Promise<ThumbnailScannerResult> {
  ensureInitialized()
  return scanner.runScan(signal)
}

export const { init: initThumbnailScanner } = createServiceInterval({
  name: 'thumbnailScanner',
  worker: async (signal) => {
    await runThumbnailScanner(signal)
  },
  getState: async () => true,
  interval: THUMBNAIL_SCANNER_INTERVAL,
})
