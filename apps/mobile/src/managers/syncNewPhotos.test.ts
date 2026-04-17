import { SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import * as MediaLibrary from 'expo-media-library'
import { syncAssets } from '../lib/processAssets'
import { app } from '../stores/appService'
import {
  initSyncNewPhotos,
  run,
  setAutoSyncNewPhotos,
  setSyncNewPhotosEnabledAt,
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
  syncAssets: jest.fn(),
}))

const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
const syncAssetsMock = jest.mocked(syncAssets)

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
  syncAssetsMock.mockResolvedValue({
    files: [{ id: '1' }] as never,
    updatedFiles: [],
    warnings: [],
  })
}

describe('syncNewPhotos', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    getAssetsAsyncMock.mockReset()
    await setAutoSyncNewPhotos(true)
    await setSyncNewPhotosEnabledAt(0)
    mockProcessAssetsSuccess()
  })

  it('sorts by creationTime DESC', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(page([asset('a1', '1.jpg', { creationTime: 5_000 })]))
    await run()
    expect(getAssetsAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: [['creationTime', false]],
      }),
    )
  })

  it('does not pass createdBefore or createdAfter', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(page([asset('a1', '1.jpg', { creationTime: 5_000 })]))
    await run()
    const opts = getAssetsAsyncMock.mock.calls[0][0]
    expect(opts).not.toHaveProperty('createdAfter')
    expect(opts).not.toHaveProperty('createdBefore')
  })

  it('only processes assets with creationTime >= enabledAt', async () => {
    await setSyncNewPhotosEnabledAt(3_000)
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', 'new1.jpg', { creationTime: 5_000 }),
        asset('a2', 'new2.jpg', { creationTime: 4_000 }),
        asset('a3', 'exact.jpg', { creationTime: 3_000 }),
        asset('a4', 'old.jpg', { creationTime: 2_000 }),
      ]),
    )
    await run()
    expect(syncAssetsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: 'a1', name: 'new1.jpg' }),
        expect.objectContaining({ id: 'a2', name: 'new2.jpg' }),
        expect.objectContaining({ id: 'a3', name: 'exact.jpg' }),
      ],
      'file',
      { addToImportDirectory: true, skipExistingUpdates: true },
      undefined,
    )
  })

  it('skips processing when all photos are before enabledAt', async () => {
    await setSyncNewPhotosEnabledAt(10_000)
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', '1.jpg', { creationTime: 5_000 }),
        asset('a2', '2.jpg', { creationTime: 3_000 }),
      ]),
    )
    await run()
    expect(syncAssetsMock).not.toHaveBeenCalled()
  })

  it('no photos returns early without processing', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce(page([]))
    await run()
    expect(syncAssetsMock).not.toHaveBeenCalled()
  })

  it('does not paginate even when page is full', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) =>
      asset(`a${i}`, `${i}.jpg`, { creationTime: 10_000 - i }),
    )
    getAssetsAsyncMock.mockResolvedValueOnce(page(fullPage, 'cursor-page-1'))
    await run()
    expect(getAssetsAsyncMock).toHaveBeenCalledTimes(1)
    expect(syncAssetsMock).toHaveBeenCalledTimes(1)
    expect(syncAssetsMock.mock.calls[0][0]).toHaveLength(50)
  })

  it('excludes old photo with AI-bumped modificationTime', async () => {
    await setSyncNewPhotosEnabledAt(10_000)
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([
        asset('a1', 'ai-bumped.jpg', {
          creationTime: 1_000,
          modificationTime: 20_000,
        }),
      ]),
    )
    await run()
    expect(syncAssetsMock).not.toHaveBeenCalled()
  })

  it('setAutoSyncNewPhotos saves enablement timestamp', async () => {
    jest.setSystemTime(new Date(1_700_000_000_000))
    await setAutoSyncNewPhotos(true)
    const enabledAt = Number(await app().storage.getItem('syncNewPhotosEnabledAt'))
    expect(enabledAt).toBe(1_700_000_000_000)
  })

  it('aborts before processAssets when shutdown is called mid-tick', async () => {
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const syncAssetsMock = jest.mocked(syncAssets)

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

    expect(syncAssetsMock).not.toHaveBeenCalled()
  })
})
