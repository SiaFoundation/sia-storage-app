import RNFS from 'react-native-fs'
import { createFsIOAdapter } from './fsIO'

jest.mock('react-native-fs', () => ({
  stat: jest.fn(),
  exists: jest.fn(),
  unlink: jest.fn(),
  copyFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  readDir: jest.fn(),
}))

const statMock = jest.mocked(RNFS.stat)
const existsMock = jest.mocked(RNFS.exists)

function mockStatResult(size: number): RNFS.StatResult {
  return {
    size,
    name: 'test',
    path: '/test',
    mode: 0,
    ctime: 0,
    mtime: 0,
    originalFilepath: '/test',
    isFile: () => true,
    isDirectory: () => false,
  }
}

describe('fsIO adapter size()', () => {
  const adapter = createFsIOAdapter()

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns size when stat succeeds', async () => {
    statMock.mockResolvedValue(mockStatResult(4096))
    const result = await adapter.size('file1', 'image/jpeg')
    expect(result).toEqual({ value: 4096 })
  })

  // Android: RNFSManager.java:633 explicitly checks !file.exists() and
  // throws "File does not exist". The exists fallback confirms deletion.
  it('returns not_found for Android missing file error', async () => {
    statMock.mockRejectedValue(new Error('File does not exist'))
    existsMock.mockResolvedValue(false)
    const result = await adapter.size('file1', 'image/jpeg')
    expect(result).toEqual({ value: null, error: 'not_found' })
  })

  // iOS: RNFSManager.m:97-100 calls attributesOfItemAtPath without a
  // pre-existence check. The NSCocoaErrorDomain error says "no such file"
  // which doesn't match ENOENT or "does not exist" — the exists fallback
  // catches this case.
  it('returns not_found for iOS missing file error', async () => {
    statMock.mockRejectedValue(
      new Error('The file "file1.jpg" couldn\'t be opened because there is no such file.'),
    )
    existsMock.mockResolvedValue(false)
    const result = await adapter.size('file1', 'image/jpeg')
    expect(result).toEqual({ value: null, error: 'not_found' })
  })

  // Both platforms: stat fails but file is still on disk (permission
  // error, I/O error, etc). Preserve the fs entry so we don't lose
  // track of files that haven't been uploaded yet.
  it('returns stat_error for genuine I/O error when file exists', async () => {
    statMock.mockRejectedValue(new Error('I/O error'))
    existsMock.mockResolvedValue(true)
    const result = await adapter.size('file1', 'image/jpeg')
    expect(result).toEqual({ value: null, error: 'stat_error' })
  })
})
