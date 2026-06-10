// Stub for the native `thumbnailer` module. The real pipeline decodes and
// encodes in native code, which can't run under jest; orientation/sizing are
// verified on-device with EXIF fixtures. Tests that need thumbnail output mock
// the facade (`app.thumbnails.*`) directly.
export type ThumbnailFile = {
  uri: string
  width: number
  height: number
  mimeType: string
}

export async function imageThumbnails(_uri: string, maxSizes: number[]): Promise<ThumbnailFile[]> {
  return maxSizes.map((size) => ({
    uri: `file:///thumb-${size}.webp`,
    width: size,
    height: size,
    mimeType: 'image/webp',
  }))
}

export async function videoThumbnail(_uri: string, maxSize: number): Promise<ThumbnailFile> {
  return {
    uri: `file:///thumb-${maxSize}.webp`,
    width: maxSize,
    height: maxSize,
    mimeType: 'image/webp',
  }
}
