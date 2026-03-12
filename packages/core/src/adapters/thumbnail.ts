export interface ThumbnailResult {
  data: ArrayBuffer
  mimeType: string
}

export interface ThumbnailAdapter {
  generateImageThumbnail(
    sourcePath: string,
    targetSize: number,
  ): Promise<ThumbnailResult>
  generateImageThumbnails(
    sourcePath: string,
    sizes: number[],
  ): Promise<Map<number, ThumbnailResult>>
  generateVideoThumbnail(
    sourcePath: string,
    targetSize: number,
  ): Promise<ThumbnailResult>
}
