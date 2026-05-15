// Adapters return one of two shapes:
//   - `data`: bytes in memory (e.g. node-adapters/sharp), written via
//     `app.fs.writeFileData`.
//   - `savedUri`: a path to the thumbnail already on disk (e.g. mobile/
//     expo-image-manipulator), moved into managed storage via `app.fs.adoptFile`.
// Any FsIOAdapter paired with a thumbnail adapter that can return `savedUri`
// MUST implement `adoptFile`; the scanner throws at runtime if it doesn't.
export type ThumbnailResult =
  | { data: ArrayBuffer; mimeType: string }
  | { savedUri: string; mimeType: string }

export interface ThumbnailOptions {
  /**
   * Media-library identifier when the source file originated from the OS
   * photo library. Mobile uses this to fetch the system-cached thumbnail
   * via PHImageManager (iOS) or ContentResolver.loadThumbnail (Android)
   * instead of decoding the full source. CLI/desktop adapters ignore it.
   */
  localId?: string | null
}

export interface ThumbnailAdapter {
  /**
   * MIME types this adapter can decode into a thumbnail. The scanner uses
   * this to filter candidates at the SQL level so unsupported types don't
   * get scanned on every cold start.
   */
  readonly thumbnailableTypes: readonly string[]
  generateImageThumbnail(
    sourcePath: string,
    targetSize: number,
    opts?: ThumbnailOptions,
  ): Promise<ThumbnailResult>
  generateImageThumbnails(
    sourcePath: string,
    sizes: number[],
    opts?: ThumbnailOptions,
  ): Promise<Map<number, ThumbnailResult>>
  generateVideoThumbnail(
    sourcePath: string,
    targetSize: number,
    opts?: ThumbnailOptions,
  ): Promise<ThumbnailResult>
}
