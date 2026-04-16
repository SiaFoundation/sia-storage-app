export interface ThumbnailResult {
  data: ArrayBuffer
  mimeType: string
}

export interface ThumbnailAdapter {
  /**
   * MIME types this adapter can decode into a thumbnail. The scanner uses
   * this to filter candidates at the SQL level so unsupported types don't
   * get scanned on every cold start.
   */
  readonly thumbnailableTypes: readonly string[]
  generateImageThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult>
  generateImageThumbnails(
    sourcePath: string,
    sizes: number[],
  ): Promise<Map<number, ThumbnailResult>>
  generateVideoThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult>
}
