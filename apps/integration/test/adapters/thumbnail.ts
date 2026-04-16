import type { ThumbnailAdapter } from '@siastorage/core/adapters'

export { createSharpThumbnailAdapter } from '@siastorage/node-adapters/thumbnail'

export function createMockThumbnailAdapter(
  overrides?: Partial<ThumbnailAdapter>,
): ThumbnailAdapter {
  return {
    async generateImageThumbnail() {
      return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
    },
    async generateImageThumbnails(_sourcePath: string, sizes: number[]) {
      const results = new Map()
      for (const size of sizes) {
        results.set(size, { data: new ArrayBuffer(64), mimeType: 'image/webp' })
      }
      return results
    },
    async generateVideoThumbnail() {
      return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
    },
    ...overrides,
  }
}
