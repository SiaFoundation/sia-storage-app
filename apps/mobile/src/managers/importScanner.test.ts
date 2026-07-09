import type { ImportFileRow, ImportRow } from '@siastorage/core/db/operations'
import RNFS from 'react-native-fs'
import { getMediaLibraryUri } from '../lib/mediaLibrary'
import { SourceRefs } from '../lib/sourceRefs'
import { app } from '../stores/appService'
import { resolveSource } from './importScanner'

jest.mock('../lib/mediaLibrary', () => ({
  getMediaLibraryUri: jest.fn(),
}))
jest.mock('import-sources', () => ({
  isNativeAvailable: jest.fn(() => false),
}))
jest.mock('../lib/sourceRefs', () => ({
  SourceRefs: {
    startAccess: jest.fn(),
    startAccessChild: jest.fn(),
    stopAccess: jest.fn(async () => {}),
    stopAccessDir: jest.fn(async () => {}),
    createFileBookmark: jest.fn(),
    releaseGrant: jest.fn(async () => {}),
  },
}))
jest.mock('../lib/contentHash', () => ({ calculateContentHash: jest.fn() }))
jest.mock('../lib/fileTypes', () => ({ getMimeType: jest.fn() }))
jest.mock('../stores/appService', () => ({ app: jest.fn() }))
jest.mock('./thumbnailScanner', () => ({ triggerThumbnailScanner: jest.fn() }))
jest.mock('./bgTaskContext', () => ({ isBgTaskActive: jest.fn(() => false) }))
jest.mock('react-native-fs', () => ({ exists: jest.fn(async () => true) }))

const getMediaLibraryUriMock = jest.mocked(getMediaLibraryUri)

function row(over: Partial<ImportFileRow>): ImportFileRow {
  return {
    id: 'r1',
    importId: 'i1',
    state: 'active',
    reason: null,
    name: 'a.mp4',
    type: 'video/mp4',
    size: 0,
    hash: null,
    createdAt: 0,
    updatedAt: 0,
    addedAt: 0,
    directoryId: null,
    mediaAssetId: null,
    sourceKind: 'media',
    sourceUri: null,
    sourceRef: null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: 1,
    claimToken: 'tok',
    ...over,
  }
}

const imp = {} as ImportRow

describe('mobile resolveSource', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('every media row resolves to an asset:// uri', async () => {
    const result = await resolveSource(row({ mediaAssetId: '42' }), imp, 'tok')
    expect(result).toEqual({ status: 'resolved', uri: 'asset://42' })
    // No expo pre-fetch: deleted/iCloud/permission surface at copy instead.
    expect(getMediaLibraryUriMock).not.toHaveBeenCalled()
  })

  it('a verify re-check probes through expo, tagging an unfetchable asset cloud-pending', async () => {
    getMediaLibraryUriMock.mockResolvedValue({ status: 'unavailable' })
    const result = await resolveSource(row({ mediaAssetId: '42' }), imp, 'tok', { verify: true })
    expect(result).toEqual({ status: 'unavailable', code: 'cloud-pending' })
  })

  it('a media row with no asset id is deleted', async () => {
    expect(await resolveSource(row({ mediaAssetId: null }), imp, 'tok')).toEqual({
      status: 'deleted',
    })
  })

  it('an ephemeral file:// row whose file vanished resolves deleted as session-expired', async () => {
    jest.mocked(RNFS.exists).mockResolvedValueOnce(false)
    const result = await resolveSource(
      row({ sourceKind: 'ephemeral', sourceUri: 'file:///cache/pick.jpg' }),
      imp,
      'tok',
    )
    expect(result).toEqual({ status: 'deleted', code: 'session-expired' })
  })

  it('an ephemeral content:// row resolves untouched (expiry classifies at copy)', async () => {
    const result = await resolveSource(
      row({ sourceKind: 'ephemeral', sourceUri: 'content://provider/doc/1' }),
      imp,
      'tok',
    )
    expect(result).toEqual({ status: 'resolved', uri: 'content://provider/doc/1' })
  })

  it('a bookmark row with no ref and a dir-child with no tree grant are deleted', async () => {
    expect(
      await resolveSource(row({ sourceKind: 'bookmark', sourceRef: null }), imp, 'tok'),
    ).toEqual({ status: 'deleted' })
    expect(
      await resolveSource(row({ sourceKind: 'dir-child', sourceUri: 'doc-1' }), imp, 'tok'),
    ).toEqual({ status: 'deleted' })
  })
})

describe('mobile resolveSource durable refs', () => {
  const updateSourceRef = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(app).mockReturnValue({
      imports: { updateSourceRef },
    } as unknown as ReturnType<typeof app>)
  })

  it('resolves a bookmark under an open scope and releases that scope after the copy', async () => {
    jest.mocked(SourceRefs.startAccess).mockResolvedValue({ uri: 'file:///doc.pdf', stale: false })
    const result = await resolveSource(
      row({ sourceKind: 'bookmark', sourceRef: 'ios-bm:AAAA' }),
      imp,
      'tok',
    )
    if (result.status !== 'resolved') throw new Error('expected resolved')
    expect(result.uri).toBe('file:///doc.pdf')
    await result.release?.()
    expect(SourceRefs.stopAccess).toHaveBeenCalledWith('ios-bm:AAAA')
  })

  it('a stale bookmark is refreshed while the scope is open and saved under the row claim', async () => {
    jest.mocked(SourceRefs.startAccess).mockResolvedValue({ uri: 'file:///moved.pdf', stale: true })
    jest.mocked(SourceRefs.createFileBookmark).mockResolvedValue('ios-bm:BBBB')

    await resolveSource(row({ sourceKind: 'bookmark', sourceRef: 'ios-bm:AAAA' }), imp, 'tok')
    expect(SourceRefs.createFileBookmark).toHaveBeenCalledWith('file:///moved.pdf')
    expect(updateSourceRef).toHaveBeenCalledWith('r1', 'tok', 'ios-bm:BBBB')
  })

  it('a failed bookmark refresh is logged and the row still resolves', async () => {
    jest.mocked(SourceRefs.startAccess).mockResolvedValue({ uri: 'file:///m.pdf', stale: true })
    jest.mocked(SourceRefs.createFileBookmark).mockRejectedValue(new Error('nope'))
    const result = await resolveSource(
      row({ sourceKind: 'bookmark', sourceRef: 'ios-bm:AAAA' }),
      imp,
      'tok',
    )
    expect(result.status).toBe('resolved')
  })

  it('a revoked grant backs off as permission-denied (user-fixable), never deleted', async () => {
    const err = new Error('revoked') as Error & { code: string }
    err.code = 'permission-denied'
    jest.mocked(SourceRefs.startAccess).mockRejectedValue(err)
    expect(
      await resolveSource(row({ sourceKind: 'bookmark', sourceRef: 'android-uri:x' }), imp, 'tok'),
    ).toEqual({ status: 'unavailable', code: 'permission-denied' })
  })

  it('a gone source resolves deleted; unknown resolver errors back off', async () => {
    const gone = new Error('gone') as Error & { code: string }
    gone.code = 'deleted'
    jest.mocked(SourceRefs.startAccess).mockRejectedValueOnce(gone)
    expect(
      await resolveSource(row({ sourceKind: 'bookmark', sourceRef: 'ios-bm:AAAA' }), imp, 'tok'),
    ).toEqual({ status: 'deleted' })

    jest.mocked(SourceRefs.startAccess).mockRejectedValueOnce(new Error('mystery'))
    expect(
      await resolveSource(row({ sourceKind: 'bookmark', sourceRef: 'ios-bm:AAAA' }), imp, 'tok'),
    ).toEqual({ status: 'unavailable', code: 'resolver-error' })
  })

  it('dir children resolve per-key under the import-level tree grant', async () => {
    jest.mocked(SourceRefs.startAccessChild).mockResolvedValue({ uri: 'content://tree/doc-1' })
    const result = await resolveSource(
      row({ sourceKind: 'dir-child', sourceUri: 'doc-1' }),
      { dirSourceRef: 'android-uri:tree' } as ImportRow,
      'tok',
    )
    expect(result).toEqual({ status: 'resolved', uri: 'content://tree/doc-1' })
    expect(SourceRefs.startAccessChild).toHaveBeenCalledWith('android-uri:tree', 'doc-1')
  })

  it('a deleted child fails alone as deleted', async () => {
    const gone = new Error('missing') as Error & { code: string }
    gone.code = 'deleted'
    jest.mocked(SourceRefs.startAccessChild).mockRejectedValue(gone)
    expect(
      await resolveSource(
        row({ sourceKind: 'dir-child', sourceUri: 'doc-2' }),
        { dirSourceRef: 'android-uri:tree' } as ImportRow,
        'tok',
      ),
    ).toEqual({ status: 'deleted' })
  })
})
