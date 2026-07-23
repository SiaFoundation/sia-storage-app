/**
 * Contract tests for the import-sources package's real index.ts, imported by
 * relative path so the jest moduleNameMapper stub doesn't intercept it; the
 * 'expo' lookup is mocked per scenario instead. Covers the TS-surface
 * contracts nothing downstream re-checks: behavior when native is absent,
 * sha256 prefixing, pickFiles mapping, and batch bookmark creation.
 */
import { IMPORT_REASONS } from '@siastorage/core/db/operations'
import type * as ImportSourcesTypes from '../../modules/import-sources'

type ImportSources = typeof ImportSourcesTypes

// resetModules gives the package a fresh react-native registry entry, so the
// platform override must target that instance, not this file's import.
function loadModule(
  native: { refs?: unknown; reader?: unknown },
  platformOS: 'ios' | 'android' = 'ios',
): ImportSources {
  jest.resetModules()
  jest.doMock('expo', () => ({
    requireOptionalNativeModule: (name: string) =>
      name === 'ImportSourceRefs' ? (native.refs ?? null) : (native.reader ?? null),
  }))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform: freshPlatform } = require('react-native') as {
    Platform: { OS: string }
  }
  Object.defineProperty(freshPlatform, 'OS', { value: platformOS, configurable: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/import-sources') as ImportSources
}

afterEach(() => {
  jest.dontMock('expo')
})

describe('import-sources contract', () => {
  it('every call fails with a coded import-sources-unavailable error when native is absent', async () => {
    const mod = loadModule({})
    expect(mod.isNativeAvailable()).toBe(false)

    const calls = [
      () => mod.createFileBookmarks(['file:///a']),
      () => mod.createDirBookmark('file:///dir'),
      () => mod.startAccess('ios-bm:AAAA'),
      () => mod.startAccessChild('ios-bm:AAAA', 'child'),
      () => mod.enumerateDir('ios-bm:AAAA'),
      () => mod.copyToPath('file:///a', '/dest'),
      () => mod.copyAsset('42', '/dest', { copyId: 'c1' }),
      () => mod.stopAccess('ios-bm:AAAA'),
      () => mod.stopAccessDir('ios-bm:AAAA'),
      () => mod.releaseGrant('android-uri:content://x'),
      () => mod.cancelCopy('c1'),
      () => mod.grantBudgetRemaining(),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'import-sources-unavailable' })
    }
    expect(() => mod.addCopyProgressListener(() => {})).toThrow()
  })

  it('lowercases and prefixes sha256: onto the bare hex native returns from copyToPath and copyAsset', async () => {
    const refs = {
      copyToPath: jest.fn(async () => ({ size: 5, sha256: 'ABCDEF', mime: 'image/jpeg' })),
    }
    const reader = {
      copyAsset: jest.fn(async () => ({
        size: 9,
        sha256: 'FEDCBA',
        mime: 'video/mp4',
        variant: 'original',
      })),
    }
    const mod = loadModule({ refs, reader })

    const copied = await mod.copyToPath('file:///src', '/dest', { copyId: 'c1' })
    expect(copied.sha256).toBe('sha256:abcdef')
    expect(refs.copyToPath).toHaveBeenCalledWith('file:///src', '/dest', 'c1')

    const asset = await mod.copyAsset('42', '/dest', { copyId: 'c2' })
    expect(asset.sha256).toBe('sha256:fedcba')
  })

  it('createFileBookmarks makes exactly one native call for N uris and isolates per-uri failures', async () => {
    const refs = {
      createFileBookmarks: jest.fn(async (uris: string[]) =>
        uris.map((uri, i) =>
          i === 1 ? { code: 'not-persistable' } : { ref: `android-uri:${uri}` },
        ),
      ),
    }
    const mod = loadModule({ refs })

    const results = await mod.createFileBookmarks(['file:///a', 'file:///b', 'file:///c'])
    expect(refs.createFileBookmarks).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      { ref: 'android-uri:file:///a' },
      { code: 'not-persistable' },
      { ref: 'android-uri:file:///c' },
    ])

    // The single-uri form rethrows the code.
    await expect(
      loadModule({
        refs: {
          createFileBookmarks: async () => [{ code: 'not-persistable' }],
        },
      }).createFileBookmark('file:///x'),
    ).rejects.toMatchObject({ code: 'not-persistable' })
  })

  it('pickFiles maps a native cancelled rejection to an empty array', async () => {
    const refs = {
      pickFiles: jest.fn(async () => {
        const e = new Error('user dismissed') as Error & { code: string }
        e.code = 'cancelled'
        throw e
      }),
    }
    const mod = loadModule({ refs })
    await expect(mod.pickFiles()).resolves.toEqual([])
  })

  it('pickFiles rejects off-iOS without touching native', async () => {
    const refs = { pickFiles: jest.fn() }
    const mod = loadModule({ refs }, 'android')

    await expect(mod.pickFiles()).rejects.toThrow('iOS-only')
    expect(refs.pickFiles).not.toHaveBeenCalled()
  })

  it('forwards progress subscriptions to the reader and returns the removable subscription', () => {
    const remove = jest.fn()
    const reader = { addListener: jest.fn(() => ({ remove })) }
    const mod = loadModule({ reader })

    const cb = jest.fn()
    const sub = mod.addCopyProgressListener(cb)
    expect(reader.addListener).toHaveBeenCalledWith('copyProgress', cb)
    sub.remove()
    expect(remove).toHaveBeenCalled()
  })

  it('every throwable code except cancelled has copy in the reasons registry', async () => {
    const mod = loadModule({})
    // `cancelled` is the suspend path, not a failure a user is shown a reason
    // for. Any other code reaching the UI without an entry renders as a raw
    // identifier.
    const missing = mod.IMPORT_SOURCES_ERROR_CODES.filter(
      (code) => code !== 'cancelled' && !(code in IMPORT_REASONS),
    )
    expect(missing).toEqual([])
  })
})
