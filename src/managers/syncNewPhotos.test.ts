import * as MediaLibrary from 'expo-media-library'
import { SYNC_NEW_PHOTOS_INTERVAL } from '../config'
import { processAssets } from '../lib/processAssets'
import { shutdownAllServiceIntervals } from '../lib/serviceInterval'
import { getAsyncStorageNumber } from '../stores/asyncStore'
import {
  initSyncNewPhotos,
  setAutoSyncNewPhotos,
  setSyncNewPhotosEnabledAt,
  workNew,
} from './syncNewPhotos'

jest.useFakeTimers()

jest.mock('expo-media-library', () => ({
  getAssetsAsync: jest.fn(),
  SortBy: {
    creationTime: 'creationTime',
    modificationTime: 'modificationTime',
  },
  MediaType: { photo: 'photo', video: 'video' },
}))
jest.mock('../lib/mediaLibraryPermissions', () => ({
  ensureMediaLibraryPermission: jest.fn(),
  getMediaLibraryPermissions: jest.fn().mockResolvedValue(true),
  mediaLibraryPermissionsCache: {
    key: jest.fn(() => ['mediaLibraryPermissions']),
    invalidate: jest.fn(),
    set: jest.fn(),
  },
}))
jest.mock('../lib/processAssets', () => ({
  processAssets: jest.fn(),
}))
jest.mock('../stores/librarySwr', () => ({
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
const processAssetsMock = jest.mocked(processAssets)

function asset(
  id: string,
  name: string,
  opts: { creationTime?: number; modificationTime?: number },
): MediaLibrary.Asset {
  return {
    id,
    filename: name,
    uri: `file://${id}`,
    mediaType: MediaLibrary.MediaType.photo,
    creationTime: opts.creationTime ?? 0,
    modificationTime: opts.modificationTime ?? 0,
    width: 1,
    height: 1,
    duration: 0,
  }
}

function page(
  assets: MediaLibrary.Asset[],
  endCursor = '',
): MediaLibrary.PagedInfo<MediaLibrary.Asset> {
  return {
    assets,
    endCursor,
    hasNextPage: false,
    totalCount: assets.length,
  }
}

function mockProcessAssetsSuccess() {
  processAssetsMock.mockResolvedValue({
    files: [{ id: '1' }] as never,
    updatedFiles: [],
    warnings: [],
  })
}

describe('syncNewPhotos', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    getAssetsAsyncMock.mockReset()
    await setSyncNewPhotosEnabledAt(0)
    mockProcessAssetsSuccess()
  })

  it('sorts by modificationTime DESC', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 5_000 })]),
    )
    await workNew()
    expect(getAssetsAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: [['modificationTime', false]],
      }),
    )
  })

  it('does not pass createdBefore or createdAfter', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 5_000 })]),
    )
    await workNew()
    const opts = getAssetsAsyncMock.mock.calls[0][0]
    expect(opts).not.toHaveProperty('createdAfter')
    expect(opts).not.toHaveProperty('createdBefore')
  })

  it('only processes assets with modificationTime >= enabledAt', async () => {
    await setSyncNewPhotosEnabledAt(3_000)
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', 'new1.jpg', { modificationTime: 5_000 }),
        asset('a2', 'new2.jpg', { modificationTime: 4_000 }),
        asset('a3', 'exact.jpg', { modificationTime: 3_000 }),
        asset('a4', 'old.jpg', { modificationTime: 2_000 }),
      ]),
    )
    await workNew()
    expect(processAssetsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1', name: 'new1.jpg' }),
      expect.objectContaining({ id: 'a2', name: 'new2.jpg' }),
      expect.objectContaining({ id: 'a3', name: 'exact.jpg' }),
    ])
  })

  it('skips processing when all photos are before enabledAt', async () => {
    await setSyncNewPhotosEnabledAt(10_000)
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', '1.jpg', { modificationTime: 5_000 }),
        asset('a2', '2.jpg', { modificationTime: 3_000 }),
      ]),
    )
    await workNew()
    expect(processAssetsMock).not.toHaveBeenCalled()
  })

  it('no photos returns early without processing', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(page([]))
    await workNew()
    expect(processAssetsMock).not.toHaveBeenCalled()
  })

  it('does not paginate even when page is full', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) =>
      asset(`a${i}`, `${i}.jpg`, { modificationTime: 10_000 - i }),
    )
    getAssetsAsyncMock.mockResolvedValueOnce(page(fullPage, 'cursor-page-1'))
    await workNew()
    expect(getAssetsAsyncMock).toHaveBeenCalledTimes(1)
    expect(processAssetsMock).toHaveBeenCalledTimes(1)
    expect(processAssetsMock.mock.calls[0][0]).toHaveLength(50)
  })

  it('falls back to modificationTime for timestamp when creationTime is 0', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', 'downloaded.jpg', {
          creationTime: 0,
          modificationTime: 5_000,
        }),
      ]),
    )
    await workNew()
    expect(processAssetsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        timestamp: new Date(5_000).toISOString(),
      }),
    ])
  })

  it('setAutoSyncNewPhotos saves enablement timestamp', async () => {
    jest.setSystemTime(new Date(1_700_000_000_000))
    await setAutoSyncNewPhotos(true)
    const enabledAt = await getAsyncStorageNumber('syncNewPhotosEnabledAt', 0)
    expect(enabledAt).toBe(1_700_000_000_000)
  })

  it('aborts before processAssets when shutdown is called mid-tick', async () => {
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    await setAutoSyncNewPhotos(true)

    let resolveGetAssets: ((v: any) => void) | null = null
    getAssetsAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGetAssets = resolve
      }),
    )

    initSyncNewPhotos()
    await jest.advanceTimersByTimeAsync(SYNC_NEW_PHOTOS_INTERVAL)

    // Worker is now blocked on getAssetsAsync.
    const shutdownPromise = shutdownAllServiceIntervals()

    // Resolve getAssetsAsync — worker will see signal.aborted and return.
    resolveGetAssets!(page([asset('a1', '1.jpg', { modificationTime: 1000 })]))
    await jest.advanceTimersByTimeAsync(0)
    await shutdownPromise

    expect(processAssetsMock).not.toHaveBeenCalled()
  })
})
