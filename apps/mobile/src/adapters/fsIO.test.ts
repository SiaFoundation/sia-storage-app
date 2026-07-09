import { IMPORT_STALE_CLAIM_MS } from '@siastorage/core/config'
import RNFS from 'react-native-fs'
import { copyToPath } from 'import-sources'
import { createFsIOAdapter } from './fsIO'

// The jest mapper serves the scriptable stub for 'import-sources'; script it
// directly (no jest.mock factory, since factories don't reach other importers
// under this repo's jest resolution) so the real importCopy routing runs.

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
const readDirMock = jest.mocked(RNFS.readDir)

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

  it('plain copy goes straight into the final slot (no temp, no rename)', async () => {
    await adapter.copy(file, 'file:///tmp/clean.png')
    const targetArg = copyFileMock.mock.calls[0][1] as string
    expect(targetArg).toMatch(/\/file1\.png$/)
    expect(targetArg).not.toMatch(/\.tmp$/)
    expect(moveFileMock).not.toHaveBeenCalled()
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

describe('fsIO adapter list() claim-temp mtime gate', () => {
  const adapter = createFsIOAdapter()

  // The test's `now` and the adapter's internal `Date.now()` must agree, or the
  // exact-boundary case races across the line under load. Freeze both.
  const NOW = 1_700_000_000_000
  let nowSpy: jest.SpyInstance

  function readDirEntry(path: string, mtimeMs: number): RNFS.ReadDirItem {
    return {
      ctime: undefined,
      mtime: new Date(mtimeMs),
      name: path.split('/').pop() ?? path,
      path,
      size: 1,
      isFile: () => true,
      isDirectory: () => false,
    }
  }

  beforeEach(() => {
    jest.resetAllMocks()
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW)
    existsMock.mockResolvedValue(true)
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  // The daily orphan sweep reads list(); a live in-progress copy's
  // `<id>.<token>.tmp` (recent mtime) must be withheld so the sweep can't
  // delete it mid-copy, while a genuinely abandoned temp (mtime older than
  // IMPORT_STALE_CLAIM_MS) is surfaced for reclamation.
  it('withholds a recent claim-temp but surfaces a stale one', async () => {
    const now = Date.now()
    readDirMock.mockResolvedValue([
      // finalized file, always surfaced (not a .tmp)
      readDirEntry('/store/files/finalized.jpg', 0),
      // live in-progress copy: mtime = now, withheld
      readDirEntry('/store/files/live.recenttok.tmp', now),
      // abandoned orphan copy: mtime older than the stale window, surfaced
      readDirEntry('/store/files/orphan.staletok.tmp', now - IMPORT_STALE_CLAIM_MS - 1000),
    ])

    const result = await adapter.list()
    expect(result).toContain('/store/files/finalized.jpg')
    expect(result).toContain('/store/files/orphan.staletok.tmp') // stale, swept
    expect(result).not.toContain('/store/files/live.recenttok.tmp') // recent, protected
  })

  // A temp exactly at the boundary (now - mtime === IMPORT_STALE_CLAIM_MS) is
  // surfaced (the gate is `>=`), and one a hair under is withheld.
  it('treats the stale boundary inclusively', async () => {
    const now = Date.now()
    readDirMock.mockResolvedValue([
      readDirEntry('/store/files/edge.tmp', now - IMPORT_STALE_CLAIM_MS),
      readDirEntry('/store/files/just-under.tmp', now - IMPORT_STALE_CLAIM_MS + 1),
    ])
    const result = await adapter.list()
    expect(result).toContain('/store/files/edge.tmp')
    expect(result).not.toContain('/store/files/just-under.tmp')
  })
})

describe('fsIO adapter importCopy()', () => {
  const adapter = createFsIOAdapter()

  beforeEach(() => {
    jest.clearAllMocks()
    existsMock.mockResolvedValue(false)
    moveFileMock.mockResolvedValue(undefined)
  })

  it('routes claim-scoped copies through the native module and publishes via a move', async () => {
    jest.mocked(copyToPath).mockResolvedValueOnce({
      size: 42,
      sha256: 'sha256:abc123',
      mime: 'image/jpeg',
    })

    const result = await adapter.importCopy({ id: 'f1', type: 'image/jpeg' }, 'file:///src.jpg', {
      claimToken: 'tok',
    })

    // Native wrote the claim temp directly; publishing it into the id slot is
    // still this adapter's job. The token-scoped temp name means a
    // stale-then-reclaimed orphan writes its own temp, so the id slot never
    // has two concurrent writers.
    expect(jest.mocked(copyToPath).mock.calls[0][1]).toContain('f1.tok.tmp')
    expect(moveFileMock).toHaveBeenCalled()
    // The native module returns the hash already normalized; the adapter passes it through.
    expect(result.sha256).toBe('sha256:abc123')
    expect(result.mime).toBe('image/jpeg')
    expect(result.size).toBe(42)
    expect(copyFileMock).not.toHaveBeenCalled()
  })

  it('a native coded failure propagates; no RNFS fallback, id slot untouched', async () => {
    const err = new Error('gone') as Error & { code: string }
    err.code = 'deleted'
    jest.mocked(copyToPath).mockRejectedValue(err)

    await expect(
      adapter.importCopy({ id: 'f1', type: 'image/jpeg' }, 'file:///src.jpg', {
        claimToken: 'tok',
      }),
    ).rejects.toMatchObject({ code: 'deleted' })
    expect(copyFileMock).not.toHaveBeenCalled()
    expect(moveFileMock).not.toHaveBeenCalled()
  })

  it('a pre-aborted signal never starts native work', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      adapter.importCopy({ id: 'f1', type: 'image/jpeg' }, 'file:///src.jpg', {
        claimToken: 'tok',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(jest.mocked(copyToPath)).not.toHaveBeenCalled()
  })
})

describe('fsIO adapter importCopy() staged move', () => {
  const adapter = createFsIOAdapter()

  beforeEach(() => {
    jest.clearAllMocks()
    existsMock.mockResolvedValue(false)
    moveFileMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue(mockStatResult(5))
  })

  it('consumes the source by rename, with no byte copy and no native hash', async () => {
    const result = await adapter.importCopy(
      { id: 'f1', type: 'image/jpeg' },
      'file:///docs/import-staging/x.jpg',
      { claimToken: 'tok', move: true },
    )
    // Two renames (origin to claim temp, claim temp to id slot), zero byte copies.
    expect(moveFileMock).toHaveBeenCalledTimes(2)
    expect(copyFileMock).not.toHaveBeenCalled()
    expect(jest.mocked(copyToPath)).not.toHaveBeenCalled()
    expect(result.sha256).toBeUndefined() // the scanner's hash pass runs
  })

  it('a failed move falls back to the copy path', async () => {
    moveFileMock.mockRejectedValueOnce(new Error('EXDEV'))
    jest.mocked(copyToPath).mockResolvedValue({ size: 5, sha256: 'sha256:aa' })
    const result = await adapter.importCopy(
      { id: 'f1', type: 'image/jpeg' },
      'file:///docs/import-staging/x.jpg',
      { claimToken: 'tok', move: true },
    )
    expect(jest.mocked(copyToPath)).toHaveBeenCalled()
    expect(result.sha256).toBe('sha256:aa')
  })
})
