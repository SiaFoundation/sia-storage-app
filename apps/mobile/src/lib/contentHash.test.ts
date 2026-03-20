import { calculateContentHash } from './contentHash'

type RNFSMocks = {
  rnfsHash: jest.Mock
}

function getMocks(): { rnfs: RNFSMocks } {
  const rnfs = (global as unknown as { __rnfs: RNFSMocks }).__rnfs
  return { rnfs }
}

beforeEach(() => {
  const { rnfs } = getMocks()
  rnfs.rnfsHash.mockReset()
})

describe('calculateContentHash', () => {
  it('returns sha256 hash from RNFS.hash', async () => {
    const { rnfs } = getMocks()
    const expectedHash =
      'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2'
    rnfs.rnfsHash.mockResolvedValueOnce(expectedHash)

    const res = await calculateContentHash('file:///test.txt')
    expect(res).toBe(`sha256:${expectedHash}`)
  })

  it('returns null when RNFS.hash fails', async () => {
    const { rnfs } = getMocks()
    rnfs.rnfsHash.mockRejectedValueOnce(new Error('hash failed'))

    const res = await calculateContentHash('file:///bad.txt')
    expect(res).toBeNull()
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
