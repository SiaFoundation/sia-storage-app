/**
 * Stub for expo-video-thumbnails.
 *
 * Video thumbnail generation would require ffmpeg which isn't available
 * in the Node.js test environment. Tests should use image files instead.
 */

export type VideoThumbnailsOptions = {
  quality?: number
  time?: number
  headers?: Record<string, string>
}

export type VideoThumbnailsResult = {
  uri: string
  width: number
  height: number
}

export async function getThumbnailAsync(
  _sourceUri: string,
  _options?: VideoThumbnailsOptions,
): Promise<VideoThumbnailsResult> {
  throw new Error('Video thumbnails not supported in tests. Use image files instead.')
}
