import { createFileBookmark, createFileBookmarks, grantBudgetRemaining } from 'import-sources'
import type { Asset } from './assetImports'
import { captureSharedFiles, stageCameraAssets, capturePickedAssets } from './importCapture'
import { stageFileForImport } from './importStaging'

jest.mock('./importStaging', () => ({
  stageFileForImport: jest.fn(),
}))

const stageMock = jest.mocked(stageFileForImport)

function pick(uri: string): Asset {
  return {
    id: undefined,
    sourceUri: uri,
    type: 'image/jpeg',
    name: uri.split('/').pop(),
    timestamp: new Date(0).toISOString(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('capturePickedAssets', () => {
  it('creates bookmarks in one batched native call and tags the picks', async () => {
    jest.mocked(grantBudgetRemaining).mockResolvedValue(500)
    jest
      .mocked(createFileBookmarks)
      .mockResolvedValue([{ ref: 'android-uri:a' }, { ref: 'android-uri:b' }])

    const tagged = await capturePickedAssets([pick('content://a'), pick('content://b')], {
      openInPlace: false,
    })
    expect(jest.mocked(createFileBookmarks)).toHaveBeenCalledTimes(1)
    expect(tagged[0]).toMatchObject({ sourceKind: 'bookmark', sourceRef: 'android-uri:a' })
    expect(tagged[1]).toMatchObject({ sourceKind: 'bookmark', sourceRef: 'android-uri:b' })
  })

  it('caps Android bookmarks at the budget minus the reserve; overflow stays ephemeral', async () => {
    // remaining 17 minus reserve 16 leaves room for exactly one pick.
    jest.mocked(grantBudgetRemaining).mockResolvedValue(17)
    jest.mocked(createFileBookmarks).mockResolvedValue([{ ref: 'android-uri:a' }])

    const tagged = await capturePickedAssets([pick('content://a'), pick('content://b')], {
      openInPlace: false,
    })
    expect(jest.mocked(createFileBookmarks)).toHaveBeenCalledWith(['content://a'])
    expect(tagged[0].sourceKind).toBe('bookmark')
    expect(tagged[1].sourceKind).toBeUndefined() // imports as ephemeral
  })

  it('a zero-room budget skips bookmark creation entirely but every pick still imports', async () => {
    jest.mocked(grantBudgetRemaining).mockResolvedValue(10) // under the reserve
    const picks = [pick('content://a')]
    const tagged = await capturePickedAssets(picks, { openInPlace: false })
    expect(jest.mocked(createFileBookmarks)).not.toHaveBeenCalled()
    expect(tagged).toEqual(picks)
  })

  it('open-in-place picks skip the grant budget (iOS has no grant table)', async () => {
    jest.mocked(createFileBookmarks).mockResolvedValue([{ ref: 'ios-bm:AAAA' }])
    const tagged = await capturePickedAssets([pick('file:///doc.pdf')], { openInPlace: true })
    expect(jest.mocked(grantBudgetRemaining)).not.toHaveBeenCalled()
    expect(tagged[0].sourceKind).toBe('bookmark')
  })

  it('a per-pick bookmark failure degrades that pick to ephemeral without failing the batch', async () => {
    jest.mocked(grantBudgetRemaining).mockResolvedValue(500)
    jest
      .mocked(createFileBookmarks)
      .mockResolvedValue([{ ref: 'android-uri:a' }, { code: 'not-persistable' }])

    const tagged = await capturePickedAssets([pick('content://a'), pick('content://b')], {
      openInPlace: false,
    })
    expect(tagged[0].sourceKind).toBe('bookmark')
    expect(tagged[1].sourceKind).toBeUndefined()
  })
})

describe('captureSharedFiles', () => {
  it('content:// payloads become grant-backed bookmarks', async () => {
    jest.mocked(createFileBookmark).mockResolvedValue('android-uri:shared')
    const [file] = await captureSharedFiles([pick('content://share/1')])
    expect(file).toMatchObject({ sourceKind: 'bookmark', sourceRef: 'android-uri:shared' })
  })

  it('file:// container copies stage by rename with the staged uri as source', async () => {
    stageMock.mockResolvedValue('file:///docs/import-staging/x.jpg')
    const [file] = await captureSharedFiles([pick('file:///container/x.jpg')])
    expect(file).toMatchObject({
      sourceKind: 'staged',
      sourceUri: 'file:///docs/import-staging/x.jpg',
    })
  })

  it('staging failure keeps the share importable as ephemeral', async () => {
    stageMock.mockResolvedValue(null)
    const original = pick('file:///container/x.jpg')
    const [file] = await captureSharedFiles([original])
    expect(file).toEqual(original)
  })
})

describe('stageCameraAssets', () => {
  it('stages capture temps as staged rows', async () => {
    stageMock.mockResolvedValue('file:///docs/import-staging/cap.jpg')
    const [asset] = await stageCameraAssets([pick('file:///tmp/cap.jpg')])
    expect(asset).toMatchObject({
      sourceKind: 'staged',
      sourceUri: 'file:///docs/import-staging/cap.jpg',
    })
  })

  it('a failed stage keeps the capture importable this session', async () => {
    stageMock.mockResolvedValue(null)
    const original = pick('file:///tmp/cap.jpg')
    const [asset] = await stageCameraAssets([original])
    expect(asset).toEqual(original)
  })
})
