import RNFS from 'react-native-fs'
import { createFsIOAdapter } from './fsIO'

jest.mock('react-native-fs', () => ({
  stat: jest.fn(),
  exists: jest.fn(),
  unlink: jest.fn(),
  copyFile: jest.fn(),
  moveFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  readDir: jest.fn(),
  hash: jest.fn(),
}))

const statMock = jest.mocked(RNFS.stat)
const existsMock = jest.mocked(RNFS.exists)
const unlinkMock = jest.mocked(RNFS.unlink)
const copyFileMock = jest.mocked(RNFS.copyFile)
const moveFileMock = jest.mocked(RNFS.moveFile)
const hashMock = jest.mocked(RNFS.hash)

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

describe('fsIO adapter copy()', () => {
  const adapter = createFsIOAdapter()
  const file = { id: 'file1', type: 'image/png' }

  beforeEach(() => {
    jest.resetAllMocks()
    existsMock.mockResolvedValue(false)
    copyFileMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue(mockStatResult(1024))
  })

  // Regression for issue #610: iOS Document Picker hands us a
  // percent-encoded file:// URL, but RNFS expects a real path.
  it('decodes percent-encoded file:// URIs', async () => {
    await adapter.copy(
      file,
      'file:///tmp/sia.storage-Inbox/Screenshot%202025-09-03%20at%2018.13.41.png',
    )
    expect(copyFileMock).toHaveBeenCalledWith(
      '/tmp/sia.storage-Inbox/Screenshot 2025-09-03 at 18.13.41.png',
      expect.any(String),
    )
  })

  it('strips the file:// prefix from unencoded URIs', async () => {
    await adapter.copy(file, 'file:///tmp/clean.png')
    expect(copyFileMock).toHaveBeenCalledWith('/tmp/clean.png', expect.any(String))
  })

  it('passes non-file URIs through unchanged', async () => {
    await adapter.copy(file, 'ph://abc123')
    expect(copyFileMock).toHaveBeenCalledWith('ph://abc123', expect.any(String))
  })

  // A malformed file:// URI (literal % not part of an escape) shouldn't
  // throw — fall back to the raw path so RNFS just reports the missing
  // file as it would have before the decode.
  it('falls back to the raw path when decoding fails', async () => {
    await adapter.copy(file, 'file:///tmp/50% off.txt')
    expect(copyFileMock).toHaveBeenCalledWith('/tmp/50% off.txt', expect.any(String))
  })

  it('removes an existing target before copying', async () => {
    existsMock.mockResolvedValue(true)
    await adapter.copy(file, 'file:///tmp/clean.png')
    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expect(copyFileMock).toHaveBeenCalledTimes(1)
  })
})

describe('fsIO adapter adoptFile()', () => {
  const adapter = createFsIOAdapter()
  const file = { id: 'file1', type: 'image/webp' }

  beforeEach(() => {
    jest.resetAllMocks()
    existsMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/files')) return true
      return false
    })
    moveFileMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue(mockStatResult(2048))
    hashMock.mockResolvedValue('deadbeef')
  })

  it('moves the file natively, stats it, and returns a sha256 hash', async () => {
    if (!adapter.adoptFile) throw new Error('adoptFile missing')
    const result = await adapter.adoptFile(file, 'file:///tmp/abc.webp')
    expect(moveFileMock).toHaveBeenCalledWith('/tmp/abc.webp', expect.any(String))
    expect(hashMock).toHaveBeenCalledWith(expect.any(String), 'sha256')
    expect(result).toMatchObject({ size: 2048, hash: 'deadbeef' })
  })

  it('removes an existing target before moving', async () => {
    existsMock.mockResolvedValue(true)
    if (!adapter.adoptFile) throw new Error('adoptFile missing')
    await adapter.adoptFile(file, 'file:///tmp/abc.webp')
    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expect(moveFileMock).toHaveBeenCalledTimes(1)
  })

  it('decodes percent-encoded file:// source URIs', async () => {
    if (!adapter.adoptFile) throw new Error('adoptFile missing')
    await adapter.adoptFile(file, 'file:///tmp/some%20file.webp')
    expect(moveFileMock).toHaveBeenCalledWith('/tmp/some file.webp', expect.any(String))
  })
})
