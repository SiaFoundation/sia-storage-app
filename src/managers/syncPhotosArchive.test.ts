import { SYNC_PHOTOS_ARCHIVE_INTERVAL } from '../config'
import * as MediaLibrary from 'expo-media-library'
import { ensureMediaLibraryPermission } from '../lib/mediaLibraryPermissions'
import { processAssets } from '../lib/processAssets'
import {
  initSyncPhotosArchive,
  getPhotosArchiveCursor,
  restartPhotosArchiveCursor,
  setAutoSyncPhotosArchive,
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
}))
jest.mock('../lib/processAssets', () => ({
  __esModule: true,
  processAssets: jest.fn(),
}))
jest.mock('../stores/library', () => ({
  __esModule: true,
  librarySwr: {
    triggerChange: jest.fn(),
    addChangeCallback: jest.fn(),
    getKey: jest.fn((k: string) => [k]),
  },
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
  a: MediaLibrary.Asset[]
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
      ensureMediaLibraryPermission
    )
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    ensureMediaLibraryPermissionMock.mockResolvedValue(true)
    await setAutoSyncPhotosArchive(true)

    getAssetsAsyncMock.mockImplementation(
      async (
        opts?: MediaLibrary.AssetsOptions
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
      }
    )

    processAssetsMock
      .mockResolvedValueOnce({ files: [], updatedFiles: [], warnings: [] })
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

    // Tick 2: createdBefore 5_000 -> returns [1_000], cursor -> 1_000
    await runTick()
    expect(processAssetsMock).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ id: 'b3', name: 'three.jpg' }),
    ])
    expect(await getPhotosArchiveCursor()).toBe(999)

    // Tick 3: createdBefore 1_000 -> returns [], cursor should reset to 0 and stop
    await runTick()
    expect(await getPhotosArchiveCursor()).toBe(0)
    expect(processAssetsMock).toHaveBeenCalledTimes(2)
  })
})
