import { requireOptionalNativeModule } from 'expo'

/** A thumbnail the native module encoded to a temp file. */
export type ThumbnailFile = {
  /** `file://` path to the encoded thumbnail; the caller adopts it into storage. */
  uri: string
  width: number
  height: number
  mimeType: string
}

type NativeModule = {
  image(uri: string, maxSizes: number[]): Promise<ThumbnailFile[]>
  video(uri: string, maxSize: number, timeMs: number): Promise<ThumbnailFile>
}

function requireNative(): NativeModule {
  const native = requireOptionalNativeModule<NativeModule>('Thumbnailer')
  if (native) return native
  // The module autolinks during prebuild; a missing one means a clean prebuild
  // was skipped. Throw rather than degrade silently — the scanner catches this
  // and marks the file errored, instead of it hiding as missing thumbnails.
  throw new Error(
    'thumbnailer: native module not found. Run a clean prebuild (expo prebuild --clean).',
  )
}

/**
 * Decodes a local image once, applies its EXIF orientation, and encodes one
 * thumbnail per requested size (long edge capped at each size). The decode is
 * subsampled at the source, so the full-resolution bitmap is never materialized.
 */
export function imageThumbnails(uri: string, maxSizes: number[]): Promise<ThumbnailFile[]> {
  return requireNative().image(uri, maxSizes)
}

/** Extracts one oriented video frame at `timeMs` and encodes it as a thumbnail. */
export function videoThumbnail(
  uri: string,
  maxSize: number,
  timeMs: number,
): Promise<ThumbnailFile> {
  return requireNative().video(uri, maxSize, timeMs)
}
