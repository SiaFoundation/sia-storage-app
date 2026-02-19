import * as MediaLibrary from 'expo-media-library'
import { SYNC_PHOTOS_ARCHIVE_INTERVAL } from '../config'
import { ensureMediaLibraryPermission } from '../lib/mediaLibraryPermissions'
import { processAssets } from '../lib/processAssets'
import {
  getPhotosArchiveCursor,
  initSyncPhotosArchive,
  restartPhotosArchiveCursor,
  setAutoSyncPhotosArchive,
  workBackward,
} from './syncPhotosArchive'

jest.useFakeTimers()

// Mocks
jest.mock('expo-media-library', () => ({
  __esModule: true,
  getAssetsAsync: jest.fn(),
  SortBy: { creationTime: 'creationTime' },
  MediaType: { photo: 'photo', video: 'video' },
}))
jest.mock('../lib/mediaLibraryPermissions', () => ({
  __esModule: true,
  ensureMediaLibraryPermission: jest.fn(),
  getMediaLibraryPermissions: jest.fn().mockResolvedValue(true),
  mediaLibraryPermissionsCache: {
    key: jest.fn(() => ['mediaLibraryPermissions']),
    invalidate: jest.fn(),
    set: jest.fn(),
  },
}))
jest.mock('../lib/processAssets', () => ({
  __esModule: true,
  processAssets: jest.fn(),
}))
jest.mock('../stores/files', () => ({
  __esModule: true,
  getFileStatsLocal: jest.fn().mockResolvedValue({ count: 0, totalBytes: 0 }),
}))
jest.mock('../stores/librarySwr', () => ({
  __esModule: true,
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

async function runTick() {
  await jest.advanceTimersByTimeAsync(SYNC_PHOTOS_ARCHIVE_INTERVAL)
}

function asset(id: string, name: string, time: number): MediaLibrary.Asset {
  return {
    id,
    filename: name,
    uri: `file://${id}`,
    mediaType: MediaLibrary.MediaType.photo,
    creationTime: time,
    modificationTime: time,
    width: 1,
    height: 1,
    duration: 0,
  }
}

function page(
  a: MediaLibrary.Asset[],
): MediaLibrary.PagedInfo<MediaLibrary.Asset> {
  return {
    assets: a,
    endCursor: '',
    hasNextPage: false,
    totalCount: a.length,
  }
}

describe('syncPhotosArchive', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('iterates backward adding files until exhausting the archive', async () => {
    const ensureMediaLibraryPermissionMock = jest.mocked(
      ensureMediaLibraryPermission,
    )
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    ensureMediaLibraryPermissionMock.mockResolvedValue(true)
    await setAutoSyncPhotosArchive(true)

    getAssetsAsyncMock.mockImplementation(
      async (
        opts?: MediaLibrary.AssetsOptions,
      ): Promise<MediaLibrary.PagedInfo<MediaLibrary.Asset>> => {
        const t = opts?.createdBefore
          ? new Date(opts.createdBefore).getTime()
          : Number.MAX_SAFE_INTEGER
        if (t >= 1_000_000)
          return page([
            asset('b1', 'one.jpg', 10_000),
            asset('b2', 'two.jpg', 5_000),
          ])
        if (t >= 4_999) return page([asset('b3', 'three.jpg', 1_000)])
        return page([])
      },
    )

    processAssetsMock
      .mockResolvedValueOnce({
        files: [
          {
            id: 'b1',
            name: 'one.jpg',
            type: 'image/jpeg',
            kind: 'file',
            size: 100,
            hash: 'hash1',
            createdAt: 10_000,
            updatedAt: 10_000,
            localId: 'b1',
            addedAt: 10_000,
            objects: {},
          },
          {
            id: 'b2',
            name: 'two.jpg',
            type: 'image/jpeg',
            kind: 'file',
            size: 100,
            hash: 'hash2',
            createdAt: 5_000,
            updatedAt: 5_000,
            localId: 'b2',
            addedAt: 10_000,
            objects: {},
          },
        ],
        updatedFiles: [],
        warnings: [],
      })
      .mockResolvedValueOnce({
        files: [
          {
            id: 'b3',
            name: 'three.jpg',
            type: 'image/jpeg',
            kind: 'file',
            size: 100,
            hash: 'hash3',
            createdAt: 1_000,
            updatedAt: 1_000,
            localId: 'b3',
            addedAt: 10_000,
            objects: {},
          },
        ],
        updatedFiles: [],
        warnings: [],
      })
      .mockResolvedValueOnce({ files: [], updatedFiles: [], warnings: [] })

    // Seed initial cursor so service is enabled.
    await restartPhotosArchiveCursor()

    initSyncPhotosArchive()

    // Tick 1: createdBefore 1_000_000 -> returns [10_000, 5_000], cursor -> 5_000
    await runTick()
    expect(processAssetsMock).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ id: 'b1', name: 'one.jpg' }),
      expect.objectContaining({ id: 'b2', name: 'two.jpg' }),
    ])
    expect(await getPhotosArchiveCursor()).toBe(4_999)

    // Tick 2: createdBefore 4_999 -> returns [1_000], cursor -> 999
    await runTick()
    expect(processAssetsMock).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ id: 'b3', name: 'three.jpg' }),
    ])
    expect(await getPhotosArchiveCursor()).toBe(999)

    // Tick 3: createdBefore 1_000 -> returns [], cursor -> 0
    await runTick()
    expect(await getPhotosArchiveCursor()).toBe(0)
    expect(processAssetsMock).toHaveBeenCalledTimes(2)
  })

  it('aborts before processAssets when signal is aborted during getAssetsAsync', async () => {
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    const ac = new AbortController()
    getAssetsAsyncMock.mockImplementation(async () => {
      ac.abort()
      return page([asset('b1', 'one.jpg', 10_000)])
    })

    await restartPhotosArchiveCursor()
    await workBackward(ac.signal)

    expect(processAssetsMock).not.toHaveBeenCalled()
  })
})
