import { calculateContentHash } from './contentHash'

type RNFSMocks = {
  rnfsStat: jest.Mock
  rnfsRead: jest.Mock
  rnfsReadFile: jest.Mock
}

function getMocks(): { rnfs: RNFSMocks } {
  const rnfs = (global as unknown as { __rnfs: RNFSMocks }).__rnfs
  return { rnfs }
}

beforeEach(() => {
  const { rnfs } = getMocks()
  rnfs.rnfsStat.mockReset()
  rnfs.rnfsRead.mockReset()
  rnfs.rnfsReadFile.mockReset()
})

describe('calculateContentHash', () => {
  it('hashes via streaming', async () => {
    // Arrange non-image path: force decode to null and stream bytes.
    const { rnfs } = getMocks()
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('not-an-image').toString('base64')
    )
    rnfs.rnfsStat.mockResolvedValueOnce({ size: 6 })
    rnfs.rnfsRead.mockResolvedValueOnce(
      Buffer.from('foobar').toString('base64')
    )

    const res = await calculateContentHash('file:///video.mov')
    expect(res).toMatchSnapshot()
  })

  it('falls back to whole-file read when stat/read fail', async () => {
    const { rnfs } = getMocks()
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('not-an-image').toString('base64')
    )
    rnfs.rnfsStat.mockRejectedValueOnce(new Error('no stat'))
    rnfs.rnfsRead.mockRejectedValueOnce(new Error('no read'))
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('abcdef').toString('base64')
    )

    const res = await calculateContentHash('content://weird')
    expect(res).toMatchSnapshot()
  })
})
