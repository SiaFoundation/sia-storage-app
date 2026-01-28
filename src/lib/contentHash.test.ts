import { calculateContentHash } from './contentHash'

type RNFSMocks = {
  rnfsStat: jest.Mock
  rnfsRead: jest.Mock
  rnfsReadFile: jest.Mock
  rnfsHash: jest.Mock
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
  rnfs.rnfsHash.mockReset()
})

describe('calculateContentHash', () => {
  it('uses RNFS.hash when available', async () => {
    const { rnfs } = getMocks()
    const expectedHash =
      'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2'
    rnfs.rnfsHash.mockResolvedValueOnce(expectedHash)

    const res = await calculateContentHash('file:///test.txt')
    expect(res).toBe(`sha256:${expectedHash}`)
  })

  it('falls back to QuickCrypto when RNFS.hash fails', async () => {
    const { rnfs } = getMocks()
    rnfs.rnfsHash.mockRejectedValueOnce(new Error('hash not supported'))
    rnfs.rnfsReadFile.mockResolvedValueOnce(
      Buffer.from('foobar').toString('base64'),
    )

    const res = await calculateContentHash('file:///video.mov')
    expect(res).toMatchSnapshot()
  })

  it('handles empty files via fallback', async () => {
    const { rnfs } = getMocks()
    rnfs.rnfsHash.mockRejectedValueOnce(new Error('hash not supported'))
    rnfs.rnfsReadFile.mockResolvedValueOnce('') // Empty base64

    const res = await calculateContentHash('file:///empty.txt')
    expect(res).toMatchSnapshot()
  })

  it('handles binary data with null bytes via fallback', async () => {
    const { rnfs } = getMocks()
    rnfs.rnfsHash.mockRejectedValueOnce(new Error('hash not supported'))
    const binaryData = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00, 0x42])
    rnfs.rnfsReadFile.mockResolvedValueOnce(binaryData.toString('base64'))

    const res = await calculateContentHash('file:///binary.bin')
    expect(res).toMatchSnapshot()
  })

  it('returns null for empty URI', async () => {
    const res = await calculateContentHash('')
    expect(res).toBeNull()
  })

  it('returns null for null URI', async () => {
    const res = await calculateContentHash(null as unknown as string)
    expect(res).toBeNull()
  })
})
