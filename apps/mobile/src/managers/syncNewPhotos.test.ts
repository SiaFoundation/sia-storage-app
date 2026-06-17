import { SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import * as MediaLibrary from 'expo-media-library'
import * as mediaObserver from 'media-observer'
import { syncAssets } from '../lib/assetImports'
import { app } from '../stores/appService'
import { initSyncNewPhotos, run, setAutoSyncNewPhotos } from './syncNewPhotos'

jest.useFakeTimers()

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn(),
  MediaType: { photo: 'photo', video: 'video' },
}))
jest.mock('media-observer', () => ({
  currentCursor: jest.fn(async () => 'v1:now'),
  changesSince: jest.fn(async () => ({ inserted: [], cursor: 'v1:now' })),
}))
jest.mock('../lib/mediaLibraryPermissions', () => ({
  ensureMediaLibraryPermission: jest.fn(),
  getMediaLibraryPermissions: jest.fn().mockResolvedValue(true),
  mediaLibraryPermissionsCache: { invalidate: jest.fn() },
}))
jest.mock('../lib/assetImports', () => ({ syncAssets: jest.fn() }))

const getAssetInfoAsyncMock = jest.mocked(MediaLibrary.getAssetInfoAsync)
const syncAssetsMock = jest.mocked(syncAssets)
const currentCursorMock = jest.mocked(mediaObserver.currentCursor)
const changesSinceMock = jest.mocked(mediaObserver.changesSince)

const CURSOR_KEY = 'syncNewPhotosCursor'

function asset(id: string, name = `${id}.jpg`): MediaLibrary.AssetInfo {
  return {
    id,
    filename: name,
    uri: `file://${id}`,
    mediaType: MediaLibrary.MediaType.photo,
    creationTime: 1_000,
    modificationTime: 0,
    width: 1,
    height: 1,
    duration: 0,
  }
}

const storedCursor = () => app().storage.getItem(CURSOR_KEY)

describe('syncNewPhotos', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    currentCursorMock.mockResolvedValue('v1:now')
    changesSinceMock.mockResolvedValue({ inserted: [], cursor: 'v1:now' })
    getAssetInfoAsyncMock.mockImplementation(async (id) => asset(String(id)))
    syncAssetsMock.mockResolvedValue({ files: [], updatedFiles: [], warnings: [] })
    await app().storage.setItem('autoSyncNewPhotos', 'true')
    await app().storage.setItem(CURSOR_KEY, 'v1:saved')
  })

  it('anchors the cursor at enable-time', async () => {
    currentCursorMock.mockResolvedValue('v1:anchored')
    await setAutoSyncNewPhotos(true)
    expect(await storedCursor()).toBe('v1:anchored')
  })

  it('imports the inserted assets and advances the cursor', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1', 'a2'], cursor: 'v1:next' })

    await run()

    expect(changesSinceMock).toHaveBeenCalledWith('v1:saved')
    expect(syncAssetsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      'file',
      { addToImportDirectory: true, skipExistingUpdates: true },
      undefined,
    )
    expect(await storedCursor()).toBe('v1:next')
  })

  it('stamps an Android no-date photo with modificationTime, not 1970', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    getAssetInfoAsyncMock.mockResolvedValue({
      ...asset('a1'),
      creationTime: 0,
      modificationTime: 5_000,
    })

    await run()

    expect(syncAssetsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ timestamp: new Date(5_000).toISOString() })],
      'file',
      { addToImportDirectory: true, skipExistingUpdates: true },
      undefined,
    )
  })

  it('advances the cursor when there are no inserts', async () => {
    changesSinceMock.mockResolvedValue({ inserted: [], cursor: 'v1:next' })

    await run()

    expect(syncAssetsMock).not.toHaveBeenCalled()
    expect(await storedCursor()).toBe('v1:next')
  })

  it('does NOT advance the cursor when ingest fails, so the ids replay', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    syncAssetsMock.mockRejectedValueOnce(new Error('boom'))

    await run()

    expect(await storedCursor()).toBe('v1:saved')
  })

  it('resolves assets without forcing an iCloud network download', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })

    await run()

    expect(getAssetInfoAsyncMock).toHaveBeenCalledWith('a1', { shouldDownloadFromNetwork: false })
  })

  it('drops ids that no longer resolve, still advancing the cursor', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['present', 'gone'], cursor: 'v1:next' })
    getAssetInfoAsyncMock.mockImplementation(async (id) => {
      if (String(id) === 'gone') throw new Error('deleted')
      return asset(String(id))
    })

    await run()

    expect(syncAssetsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'present' })],
      'file',
      { addToImportDirectory: true, skipExistingUpdates: true },
      undefined,
    )
    expect(await storedCursor()).toBe('v1:next')
  })

  it('skips when disabled', async () => {
    await app().storage.setItem('autoSyncNewPhotos', 'false')
    await run()
    expect(changesSinceMock).not.toHaveBeenCalled()
  })

  it('does not advance the cursor when aborted mid-tick', async () => {
    let resolveChanges: ((v: { inserted: string[]; cursor: string }) => void) | null = null
    changesSinceMock.mockReturnValue(
      new Promise((resolve) => {
        resolveChanges = resolve
      }),
    )

    initSyncNewPhotos()
    await jest.advanceTimersByTimeAsync(SYNC_NEW_PHOTOS_INTERVAL)

    const shutdown = shutdownAllServiceIntervals()
    resolveChanges!({ inserted: ['a1'], cursor: 'v1:next' })
    await jest.advanceTimersByTimeAsync(0)
    await shutdown

    expect(syncAssetsMock).not.toHaveBeenCalled()
    expect(await storedCursor()).toBe('v1:saved')
  })
})
