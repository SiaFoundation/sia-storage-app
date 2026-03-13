export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / k ** i
  return `${value.toLocaleString(undefined, { minimumFractionDigits: i === 0 ? 0 : 1, maximumFractionDigits: i === 0 ? 0 : 1 })} ${sizes[i]}`
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const kindMap: Record<string, string> = {
  'image/jpeg': 'JPEG Image',
  'image/jpg': 'JPEG Image',
  'image/png': 'PNG Image',
  'image/gif': 'GIF Image',
  'image/webp': 'WebP Image',
  'image/svg+xml': 'SVG Image',
  'image/heic': 'HEIC Image',
  'image/heif': 'HEIF Image',
  'image/tiff': 'TIFF Image',
  'image/bmp': 'BMP Image',
  'video/mp4': 'MP4 Video',
  'video/quicktime': 'QuickTime Video',
  'video/webm': 'WebM Video',
  'video/x-msvideo': 'AVI Video',
  'video/x-matroska': 'MKV Video',
  'audio/mpeg': 'MP3 Audio',
  'audio/mp4': 'M4A Audio',
  'audio/wav': 'WAV Audio',
  'audio/ogg': 'OGG Audio',
  'audio/flac': 'FLAC Audio',
  'audio/aac': 'AAC Audio',
  'text/plain': 'Text Document',
  'text/html': 'HTML Document',
  'text/css': 'CSS Stylesheet',
  'text/csv': 'CSV File',
  'application/pdf': 'PDF Document',
  'application/json': 'JSON File',
  'application/zip': 'ZIP Archive',
  'application/x-tar': 'TAR Archive',
  'application/gzip': 'GZIP Archive',
}

export function formatFileType(mimeType: string): string {
  const mapped = kindMap[mimeType]
  if (mapped) return mapped
  const [prefix, subtype] = mimeType.split('/')
  if (!subtype) return 'File'
  const label = subtype.replace(/^x-/, '').toUpperCase()
  const category =
    prefix === 'image'
      ? 'Image'
      : prefix === 'video'
        ? 'Video'
        : prefix === 'audio'
          ? 'Audio'
          : 'File'
  return `${label} ${category}`
}
