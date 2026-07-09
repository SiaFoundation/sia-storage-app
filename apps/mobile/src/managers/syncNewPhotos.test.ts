import { IMPORT_IDLE_SEAL_MS, SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
import type { AppendToOpenImportResult, ImportFileRow } from '@siastorage/core/db/operations'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import * as MediaLibrary from 'expo-media-library'
import * as mediaObserver from 'media-observer'
import { buildPhotoCandidateRows, resolveImportDirectoryId } from '../lib/assetImports'
import { app } from '../stores/appService'
import { triggerImportScanner } from './importScanner'
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
  mediaLibraryPermissionsCache: {
    key: jest.fn(() => ['mediaLibraryPermissions']),
    invalidate: jest.fn(),
    set: jest.fn(),
  },
}))
jest.mock('../lib/assetImports', () => ({
  buildPhotoCandidateRows: jest.fn(),
  resolveImportDirectoryId: jest.fn().mockResolvedValue(null),
}))
jest.mock('./importScanner', () => ({
  triggerImportScanner: jest.fn(),
}))

const getAssetInfoAsyncMock = jest.mocked(MediaLibrary.getAssetInfoAsync)
const currentCursorMock = jest.mocked(mediaObserver.currentCursor)
const changesSinceMock = jest.mocked(mediaObserver.changesSince)
const buildRowsMock = jest.mocked(buildPhotoCandidateRows)
const resolveDirMock = jest.mocked(resolveImportDirectoryId)
const triggerScannerMock = jest.mocked(triggerImportScanner)

let sealIdleSpy: jest.SpyInstance
let appendSpy: jest.SpyInstance

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

function row(id: string, mediaAssetId: string): ImportFileRow {
  return {
    id,
    importId: 'imp-open',
    state: 'pending',
    reason: null,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    size: 0,
    hash: null,
    createdAt: 0,
    updatedAt: 0,
    addedAt: 0,
    directoryId: null,
    mediaAssetId,
    sourceKind: 'media',
    sourceUri: `file://${mediaAssetId}`,
    sourceRef: null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    claimToken: null,
  }
}

const appended: AppendToOpenImportResult = { action: 'appended', importId: 'imp-open' }

const storedCursor = () => app().storage.getItem(CURSOR_KEY)

describe('syncNewPhotos', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    currentCursorMock.mockResolvedValue('v1:now')
    changesSinceMock.mockResolvedValue({ inserted: [], cursor: 'v1:now' })
    getAssetInfoAsyncMock.mockImplementation(async (id) => asset(String(id)))
    buildRowsMock.mockResolvedValue([])
    resolveDirMock.mockResolvedValue(null)
    sealIdleSpy = jest.spyOn(app().imports, 'sealIdle').mockResolvedValue(undefined)
    appendSpy = jest.spyOn(app().imports, 'appendToOpenImport').mockResolvedValue(appended)
    await app().storage.setItem('autoSyncNewPhotos', 'true')
    await app().storage.setItem(CURSOR_KEY, 'v1:saved')
  })

  afterEach(() => {
    sealIdleSpy.mockRestore()
    appendSpy.mockRestore()
  })

  it('anchors the cursor at enable-time', async () => {
    currentCursorMock.mockResolvedValue('v1:anchored')
    await setAutoSyncNewPhotos(true)
    expect(await storedCursor()).toBe('v1:anchored')
  })

  it('appends the inserted assets to the open import, kicks the scanner, advances the cursor', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1', 'a2'], cursor: 'v1:next' })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1'), row('r2', 'a2')])

    await run()

    expect(changesSinceMock).toHaveBeenCalledWith('v1:saved')
    expect(buildRowsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      expect.any(String),
      null,
      expect.any(Number),
    )
    expect(appendSpy).toHaveBeenCalledWith(
      'new-photos',
      expect.objectContaining({
        source: 'new-photos',
        sealed: 0,
        dedupByHash: 1,
        expectedCount: 2,
      }),
      [
        expect.objectContaining({ mediaAssetId: 'a1' }),
        expect.objectContaining({ mediaAssetId: 'a2' }),
      ],
      expect.any(Number),
    )
    expect(triggerScannerMock).toHaveBeenCalledTimes(1)
    expect(await storedCursor()).toBe('v1:next')
  })

  it('stamps an Android no-date photo with modificationTime, not 1970', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    getAssetInfoAsyncMock.mockResolvedValue({
      ...asset('a1'),
      creationTime: 0,
      modificationTime: 5_000,
    })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1')])

    await run()

    expect(buildRowsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ timestamp: new Date(5_000).toISOString() })],
      expect.any(String),
      null,
      expect.any(Number),
    )
  })

  it('advances the cursor when there are no inserts', async () => {
    changesSinceMock.mockResolvedValue({ inserted: [], cursor: 'v1:next' })

    await run()

    expect(appendSpy).not.toHaveBeenCalled()
    expect(await storedCursor()).toBe('v1:next')
  })

  it('creates no import but still advances the cursor when every asset is already imported', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    buildRowsMock.mockResolvedValueOnce([]) // every asset already has an import_files row

    await run()

    expect(appendSpy).not.toHaveBeenCalled()
    expect(triggerScannerMock).not.toHaveBeenCalled()
    expect(await storedCursor()).toBe('v1:next')
  })

  it('holds the cursor when a detected id fails to resolve (pending row), appending the rest', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1', 'a2'], cursor: 'v1:next' })
    // a2 is mid-scan: MediaLibrary can't see IS_PENDING rows and returns null.
    getAssetInfoAsyncMock.mockImplementation(async (id) =>
      id === 'a2' ? (null as unknown as MediaLibrary.AssetInfo) : asset(String(id)),
    )
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1')])

    await run()

    expect(appendSpy).toHaveBeenCalled() // a1 still lands this tick
    expect(await storedCursor()).toBe('v1:saved') // a2 replays next tick
  })

  it('a hung changesSince call times out instead of wedging the tick, holding the cursor', async () => {
    jest.useFakeTimers()
    // A native promise that never settles: without the timeout the worker never
    // returns and the scheduler never runs another tick.
    changesSinceMock.mockImplementation(() => new Promise(() => {}))

    const tick = run()
    await jest.advanceTimersByTimeAsync(21_000)
    await tick // settles because the timeout rejected; tick_failed swallows it

    expect(await storedCursor()).toBe('v1:saved')
    jest.useRealTimers()
  })

  it('does NOT advance the cursor when the append fails, so the ids replay', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1')])
    appendSpy.mockRejectedValueOnce(new Error('boom'))

    await run()

    expect(await storedCursor()).toBe('v1:saved')
  })

  it('neither kicks the scanner nor advances the cursor while the open import is sealed and draining', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1')])
    appendSpy.mockResolvedValueOnce({ action: 'waited', importId: 'drain' })

    await run()

    expect(triggerScannerMock).not.toHaveBeenCalled()
    // The ids replay next tick into the next open import (buildPhotoCandidateRows
    // dedups by asset id, so the replay is idempotent).
    expect(await storedCursor()).toBe('v1:saved')
  })

  it('resolves assets without forcing an iCloud network download', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['a1'], cursor: 'v1:next' })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1')])

    await run()

    expect(getAssetInfoAsyncMock).toHaveBeenCalledWith('a1', { shouldDownloadFromNetwork: false })
  })

  it('holds the cursor when a resolve throws, still appending the survivors', async () => {
    changesSinceMock.mockResolvedValue({ inserted: ['present', 'flaky'], cursor: 'v1:next' })
    getAssetInfoAsyncMock.mockImplementation(async (id) => {
      if (String(id) === 'flaky') throw new Error('photos db busy')
      return asset(String(id))
    })
    buildRowsMock.mockResolvedValueOnce([row('r1', 'present')])

    await run()

    expect(buildRowsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'present' })],
      expect.any(String),
      null,
      expect.any(Number),
    )
    // A truly deleted row disappears from changesSince by itself; a throw is
    // transient. Either way the tick must not advance past the id.
    expect(await storedCursor()).toBe('v1:saved')
  })

  it('skips when disabled', async () => {
    await app().storage.setItem('autoSyncNewPhotos', 'false')
    await run()
    expect(changesSinceMock).not.toHaveBeenCalled()
  })

  it('seals idle new-photos open imports on each run', async () => {
    await run()
    expect(sealIdleSpy).toHaveBeenCalledWith('new-photos', IMPORT_IDLE_SEAL_MS, expect.any(Number))
  })

  it('init seals any leftover open import on startup (idleMs=0)', () => {
    initSyncNewPhotos()
    expect(sealIdleSpy).toHaveBeenCalledWith('new-photos', 0, expect.any(Number))
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

    expect(appendSpy).not.toHaveBeenCalled()
    expect(await storedCursor()).toBe('v1:saved')
  })
})
