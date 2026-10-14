// iOS pickers (Document Picker, share inbox) hand over percent-encoded
// `file://` URLs, `Screenshot%202025-09-03.png`, but RNFS and the SDK expect
// a real filesystem path with literal spaces. A name with a literal `%` that
// is not an escape makes decodeURIComponent throw, and the raw path is the
// file's real name then.
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  const path = uri.slice('file://'.length)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
