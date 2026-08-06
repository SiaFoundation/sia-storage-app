import { assertSocketPathFits, isProviderChannel } from '../../src/daemon/ipc/provider'

describe('isProviderChannel', () => {
  it('allows the provider namespace', () => {
    expect(isProviderChannel('ds:provider:list')).toBe(true)
    expect(isProviderChannel('ds:provider:fetch')).toBe(true)
  })

  it('allows the two calls that are not plain request and response', () => {
    expect(isProviderChannel('hello')).toBe(true)
    expect(isProviderChannel('subscribe')).toBe(true)
  })

  it('refuses every other namespace', () => {
    expect(isProviderChannel('ping')).toBe(false)
    expect(isProviderChannel('ds:secrets:getItem')).toBe(false)
    expect(isProviderChannel('ds:auth:clearAppKeys')).toBe(false)
    expect(isProviderChannel('ds:files:deleteAll')).toBe(false)
    expect(isProviderChannel('shutdown')).toBe(false)
    expect(isProviderChannel('upload')).toBe(false)
  })

  it('refuses a channel that merely starts like the provider prefix', () => {
    expect(isProviderChannel('ds:providerX:list')).toBe(false)
  })
})

describe('assertSocketPathFits', () => {
  it('accepts a path within the limit', () => {
    expect(() =>
      assertSocketPathFits('/Users/x/Library/Containers/a.b.c/Data/provider.sock'),
    ).not.toThrow()
  })

  it('refuses a path the kernel would truncate', () => {
    const long = `/${'a'.repeat(120)}/provider.sock`

    expect(() => assertSocketPathFits(long)).toThrow(/over the 103-byte limit/)
  })

  it('counts bytes rather than characters', () => {
    // Each of these is one character but three bytes in UTF-8, so a path that
    // looks short by length is over the limit on the wire.
    const path = `/${'é'.repeat(45)}/provider.sock`

    expect(path.length).toBeLessThan(103)
    expect(() => assertSocketPathFits(path)).toThrow(/over the 103-byte limit/)
  })
})
