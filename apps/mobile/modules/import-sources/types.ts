// The module's shared TS surface: every public type plus the error-code
// constants. Pure on purpose, with no `expo` import, so the jest mock can
// re-export it instead of duplicating it (a duplicated code list drifted
// once already). index.ts re-exports everything here and adds the bindings.

/** Tagged opaque durable ref: `ios-bm:<base64>` or `android-uri:<uri>`. */
export type SourceRef = string

export type StartAccessResult = {
  uri: string
  /** iOS only: the bookmark resolved but the caller should refresh it. */
  stale: boolean
}

export type DirEntry = { name: string; key: string; size: number; type: string }

/** headerBytes: the file's first bytes (up to 32) from the copy's single
 * read, for the JS type classifier. Absent when the file is empty. */
export type CopyToPathResult = { size: number; sha256: string; headerBytes?: Uint8Array }

export type CopyAssetResult = {
  size: number
  sha256: string
  mime: string
  variant: 'original' | 'rendered'
}

export type CopyProgressEvent = {
  copyId: string
  bytesCopied: number
  totalBytes: number | null
  fraction: number | null
}

export type PickedFile = {
  uri: string
  name: string
  size?: number
  mimeType?: string
  lastModified?: number
  /** iOS only: durable bookmark minted inside the pick delegate, where the
   * picker's security-scoped URL objects still exist. Absent when creation
   * failed; `refError` carries the code. A bookmark created later from the
   * uri string can never resolve, so this is the only valid source of refs
   * for open-in-place picks. Android refs are grants taken after the pick. */
  ref?: SourceRef
  refError?: string
}

export type PickedMedia = {
  /** Android: the picker's content:// uri, streamed directly by the scanner. */
  uri?: string
  /** iOS: the PHAsset identifier; the pick stages as a media-kind row and
   * the scanner reads it through the photo library. */
  mediaAssetId?: string
  /** iOS: false when the id fetched empty, meaning the asset sits outside
   * the app's limited-access selection; the pick classifies
   * permission-denied instead of importing an exported temp. */
  accessible?: boolean
  name?: string
  size?: number
  mimeType?: string
  /** Capture time in epoch ms when the provider exposes it. */
  lastModified?: number
}

export type CreateBookmarkResult = { ref: SourceRef } | { code: string }

export type Subscription = { remove(): void }

/**
 * Every code the native modules can throw (`error.code` on the rejection).
 * Every code except `cancelled` is a core import reason code; `cancelled`
 * maps to the cancelled import-file state, not a failure reason.
 */
export const IMPORT_SOURCES_ERROR_CODES = [
  'deleted',
  'permission-denied',
  'cloud-download-failed',
  'source-pending',
  'not-enough-space',
  'not-persistable',
  'io-error',
  'resolver-error',
  'cancelled',
  'unsupported',
] as const

export const IMPORT_SOURCES_UNAVAILABLE = 'import-sources-unavailable'
