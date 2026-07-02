// Stub for the import-sources native module, presenting as native-present:
// acquiring calls throw 'not mocked' until a test scripts the jest.fn
// instance, release and query calls are inert no-ops. Types and error-code
// constants come from the module's pure types file (the real index.ts pulls
// in 'expo', which jest cannot resolve). The contract test imports the real
// package index by relative path and mocks 'expo' instead.
import type {
  CopyAssetResult,
  CopyProgressEvent,
  CopyToPathResult,
  CreateBookmarkResult,
  DirEntry,
  PickedFile,
  PickedMedia,
  SourceRef,
  StartAccessResult,
  Subscription,
} from '../../modules/import-sources/types'

export * from '../../modules/import-sources/types'

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
export const pickMedia = jest.fn(async (): Promise<PickedMedia[]> => notMocked())

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
