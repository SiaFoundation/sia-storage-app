// Stub for the import-sources native module, presenting as native-present:
// acquiring calls throw 'not mocked' until a test scripts the jest.fn
// instance, release and query calls are inert no-ops. The contract test
// imports the real package index by relative path and mocks 'expo' instead.
export type SourceRef = string
export type StartAccessResult = { uri: string; stale: boolean }
export type DirEntry = { name: string; key: string; size: number; type: string }
export type CopyToPathResult = { size: number; sha256: string; mime?: string }
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
}
export type CreateBookmarkResult = { ref: SourceRef } | { code: string }
export type Subscription = { remove(): void }

export const IMPORT_SOURCES_ERROR_CODES = [
  'deleted',
  'permission-denied',
  'cloud-download-failed',
  'source-pending',
  'not-enough-space',
  'not-persistable',
  'io-error',
  'cancelled',
  'unsupported',
] as const

export const IMPORT_SOURCES_UNAVAILABLE = 'import-sources-unavailable'

function notMocked(): never {
  throw new Error('import-sources: not mocked')
}

// jest.fn-based so tests script behavior on the shared instance: an in-file
// jest.mock factory does not reach other importers under this repo's jest
// resolution (the same reason sharedContainer has explicit mapper entries).
export const isNativeAvailable = jest.fn((): boolean => true)

export const createFileBookmarks = jest.fn(
  async (_uris: string[]): Promise<CreateBookmarkResult[]> => notMocked(),
)
export const createFileBookmark = jest.fn(async (_uri: string): Promise<SourceRef> => notMocked())
export const createDirBookmark = jest.fn(async (_uri: string): Promise<SourceRef> => notMocked())
export const startAccess = jest.fn(
  async (_ref: SourceRef): Promise<StartAccessResult> => notMocked(),
)
export const startAccessChild = jest.fn(
  async (_dirRef: SourceRef, _key: string): Promise<{ uri: string }> => notMocked(),
)
export const enumerateDir = jest.fn(async (_dirRef: SourceRef): Promise<DirEntry[]> => notMocked())
export const copyToPath = jest.fn(
  async (
    _srcUri: string,
    _destPath: string,
    _opts?: { copyId?: string },
  ): Promise<CopyToPathResult> => notMocked(),
)
export const copyAsset = jest.fn(
  async (
    _assetId: string,
    _destPath: string,
    _opts: { copyId: string },
  ): Promise<CopyAssetResult> => notMocked(),
)
export const pickFiles = jest.fn(async (): Promise<PickedFile[]> => notMocked())

export const stopAccess = jest.fn(async (_ref: SourceRef): Promise<void> => {})
export const stopAccessDir = jest.fn(async (_dirRef: SourceRef): Promise<void> => {})
export const releaseGrant = jest.fn(async (_ref: SourceRef): Promise<void> => {})
export const cancelCopy = jest.fn(async (_copyId: string): Promise<void> => {})
export const getAssetSizes = jest.fn(
  async (_assetIds: string[]): Promise<Record<string, number | null>> => ({}),
)
export const grantBudgetRemaining = jest.fn(async (): Promise<number> => 0)
export const addCopyProgressListener = jest.fn(
  (_cb: (e: CopyProgressEvent) => void): Subscription => ({ remove() {} }),
)
