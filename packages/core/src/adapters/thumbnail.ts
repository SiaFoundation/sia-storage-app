export interface ThumbnailResult {
  data: ArrayBuffer
  mimeType: string
}

export interface ThumbnailAdapter {
  generateImageThumbnail(
    sourcePath: string,
    targetSize: number,
  ): Promise<ThumbnailResult>
  generateVideoThumbnail(
    sourcePath: string,
    targetSize: number,
  ): Promise<ThumbnailResult>
}
