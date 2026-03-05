import type {
  ThumbnailAdapter,
  ThumbnailResult,
} from '@siastorage/core/adapters'
import { computeTargetDimensions } from '@siastorage/core/services/thumbnailScanner'
import type { ThumbSize } from '@siastorage/core/types'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'

async function getImageSize(
  uri: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ width: w, height: h }),
      () => resolve(null),
    )
  })
}

async function resizeToWebP(
  inputUri: string,
  targetWidth?: number,
  targetHeight?: number,
): Promise<ThumbnailResult> {
  const ctx = ImageManipulator.manipulate(inputUri)
  ctx.resize({ width: targetWidth, height: targetHeight })
  const ref = await ctx.renderAsync()
  const result = await ref.saveAsync({
    compress: 0.8,
    format: SaveFormat.WEBP,
  })
  const file = new File(result.uri)
  const data = await file.bytes()
  return {
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    mimeType: 'image/webp',
  }
}

export function createMobileThumbnailAdapter(): ThumbnailAdapter {
  return {
    async generateImageThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      const size = targetSize as ThumbSize
      const imgSize = await getImageSize(sourcePath)
      const { targetWidth, targetHeight } = computeTargetDimensions(
        imgSize?.width,
        imgSize?.height,
        size,
      )
      return resizeToWebP(sourcePath, targetWidth, targetHeight)
    },

    async generateVideoThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      const size = targetSize as ThumbSize
      const thumb = await VideoThumbnails.getThumbnailAsync(sourcePath, {
        time: 1000,
        quality: 0.8,
      })
      const { targetWidth, targetHeight } = computeTargetDimensions(
        thumb.width ?? 0,
        thumb.height ?? 0,
        size,
      )
      return resizeToWebP(thumb.uri, targetWidth, targetHeight)
    },
  }
}
