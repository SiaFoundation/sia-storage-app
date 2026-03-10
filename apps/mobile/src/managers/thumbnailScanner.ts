import { THUMBNAIL_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ThumbnailScanner,
  type ThumbnailScannerResult,
} from '@siastorage/core/services/thumbnailScanner'
import { Buffer } from 'buffer'
import { Directory, File, Paths } from 'expo-file-system'
import RNFS from 'react-native-fs'
import { createMobileThumbnailAdapter } from '../adapters/thumbnail'
import { db } from '../db'
import { sha256File } from '../lib/contentHash'
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
    detectMimeType: (path: string) => detectMimeType(path),
    getFsFileUri: (file) => getFsFileUri(file),
    async copyToFs(file, data) {
      const type = await getMimeType({
        type: file.type,
        name: 'thumbnail.webp',
      })
      const tmpPath = `${file.id}.webp`
      const tmpDir = new Directory(Paths.cache, 'thumb-tmp')
      if (!tmpDir.info().exists) await RNFS.mkdir(tmpDir.uri)
      const tmpFile = new File(tmpDir, tmpPath)
      await RNFS.writeFile(
        tmpFile.uri,
        Buffer.from(data).toString('base64'),
        'base64',
      )
      const hash = await sha256File(tmpFile.uri)
      const uri = await copyFileToFs({ id: file.id, type }, tmpFile)
      const stat = await RNFS.stat(uri)
      return { uri, size: stat.size ?? data.byteLength, hash }
    },
    async invalidateCache(fileId) {
      invalidateThumbnailsForFileId(fileId)
    },
  })
}

export async function runThumbnailScanner(
  signal?: AbortSignal,
): Promise<ThumbnailScannerResult> {
  ensureInitialized()
  const result = await scanner.runScan(signal)
  if (result.produced.length > 0) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
  return result
}

export const { init: initThumbnailScanner } = createServiceInterval({
  name: 'thumbnailScanner',
  worker: async (signal) => {
    await runThumbnailScanner(signal)
  },
  getState: async () => true,
  interval: THUMBNAIL_SCANNER_INTERVAL,
})
