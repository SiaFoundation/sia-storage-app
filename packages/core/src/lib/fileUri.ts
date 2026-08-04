export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  return decodeURIComponent(uri.slice('file://'.length))
}
