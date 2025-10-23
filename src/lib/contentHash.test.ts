import { calculateContentHash } from './contentHash'

type RNFSMocks = {
  rnfsStat: jest.Mock
  rnfsRead: jest.Mock
  rnfsReadFile: jest.Mock
}
type SkiaMocks = { makeImageFromEncoded: jest.Mock }

function getMocks(): { rnfs: RNFSMocks; skia: SkiaMocks } {
  const rnfs = (global as unknown as { __rnfs: RNFSMocks }).__rnfs
  const skia = (global as unknown as { __skia: SkiaMocks }).__skia
  return { rnfs, skia }
}

beforeEach(() => {
  const { rnfs, skia } = getMocks()
  rnfs.rnfsStat.mockReset()
  rnfs.rnfsRead.mockReset()
  rnfs.rnfsReadFile.mockReset()
  skia.makeImageFromEncoded.mockReset()
})

describe('calculateContentHash', () => {
  it('hashes images via IMGv1-RGBA scheme with canonical pixels', async () => {
    // Arrange image decode path.
    const { rnfs, skia } = getMocks()
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('fake-image').toString('base64')
    )
    skia.makeImageFromEncoded.mockReturnValueOnce({
      width: () => 2,
      height: () => 1,
      // Two pixels (RGBA per pixel): [255,0,0,255] [0,255,0,255]
      readPixels: () => new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    })

    const res = await calculateContentHash('file:///test.heic')
    expect(res).toMatchSnapshot()
  })

  it('hashes non-images via BYTESv1 scheme using streaming', async () => {
    // Arrange non-image path: force decode to null and stream bytes.
    const { rnfs, skia } = getMocks()
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('not-an-image').toString('base64')
    )
    skia.makeImageFromEncoded.mockReturnValueOnce(null)
    rnfs.rnfsStat.mockResolvedValueOnce({ size: 6 })
    rnfs.rnfsRead.mockResolvedValueOnce(
      Buffer.from('foobar').toString('base64')
    )

    const res = await calculateContentHash('file:///video.mov')
    expect(res).toMatchSnapshot()
  })

  it('falls back to whole-file read when stat/read fail', async () => {
    const { rnfs, skia } = getMocks()
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('not-an-image').toString('base64')
    )
    skia.makeImageFromEncoded.mockReturnValueOnce(null)
    rnfs.rnfsStat.mockRejectedValueOnce(new Error('no stat'))
    rnfs.rnfsRead.mockRejectedValueOnce(new Error('no read'))
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('abcdef').toString('base64')
    )

    const res = await calculateContentHash('content://weird')
    expect(res).toMatchSnapshot()
  })
})
