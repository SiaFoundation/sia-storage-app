import type { DatabaseAdapter } from '@siastorage/core/adapters'
import { detectMimeType } from '@siastorage/core/lib/detectMimeType'
import type { ThumbnailDeps } from '@siastorage/core/services/thumbnailScanner'
import type { buildFsDeps } from './fs'

export function buildThumbnailDeps(params: {
  db: DatabaseAdapter
  fs: ReturnType<typeof buildFsDeps>
}): ThumbnailDeps {
  const { db, fs } = params

  let sharp: any
  try {
    sharp = require('sharp')
  } catch {
    // sharp not available
  }

  return {
    db,
    thumbnailAdapter: {
      async generateImageThumbnail(sourcePath: string, targetSize: number) {
        const filePath = sourcePath.replace('file://', '')
        const buf = await sharp(filePath)
          .resize(targetSize, targetSize, { fit: 'inside' })
          .webp({ quality: 80 })
          .toBuffer()
        return {
          data: buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength,
          ),
          mimeType: 'image/webp',
        }
      },
      async generateImageThumbnails(sourcePath: string, sizes: number[]) {
        const results = new Map()
        for (const size of sizes) {
          const filePath = sourcePath.replace('file://', '')
          const buf = await sharp(filePath)
            .resize(size, size, { fit: 'inside' })
            .webp({ quality: 80 })
            .toBuffer()
          results.set(size, {
            data: buf.buffer.slice(
              buf.byteOffset,
              buf.byteOffset + buf.byteLength,
            ),
            mimeType: 'image/webp',
          })
        }
        return results
      },
      async generateVideoThumbnail(_sourcePath: string, _targetSize: number) {
        const placeholder = Buffer.alloc(64)
        return {
          data: placeholder.buffer.slice(
            placeholder.byteOffset,
            placeholder.byteOffset + placeholder.byteLength,
          ),
          mimeType: 'image/webp',
        }
      },
    },
    async detectMimeType(filePath: string): Promise<string | null> {
      const resolved = filePath.replace('file://', '')
      const result = detectMimeType({ fileName: resolved })
      return result === 'application/octet-stream' ? null : result
    },
    getFsFileUri: (file) => fs.getFsFileUri(file),
    copyToFs: (file, data) => fs.copyToFs(file, data),
  }
}
