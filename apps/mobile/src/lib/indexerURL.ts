// Indexers are always reached over https — indexd assumes https:// for its
// signature and exposing an indexer over http is unsafe. We lock the protocol
// in the UI and only ever store/auth an https URL, so the user types just the
// host (and we strip any protocol they happen to paste in).

/**
 * Remove any leading scheme(s) (https://, http://, ftp://, …) and surrounding
 * whitespace, leaving the host. The `+` collapses an accidentally repeated
 * prefix (e.g. a pasted "https://https://host") rather than leaking one through.
 */
export function stripProtocol(value: string) {
  return value
    .trim()
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)+/i, '')
    .trim()
}

/** Build the full https URL from a host, or '' when no host has been entered. */
export function buildIndexerURL(value: string) {
  const host = stripProtocol(value)
  return host ? `https://${host}` : ''
}
