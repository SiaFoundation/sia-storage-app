import { parseContentHash, toContentHash } from './contentHash'

const HEX = 'ab'.repeat(32)

describe('toContentHash', () => {
  it('prefixes a hex digest and lowercases it', () => {
    expect(toContentHash(HEX.toUpperCase())).toBe(`sha256:${HEX}`)
  })

  it('rejects a value that is already prefixed, so nothing is prefixed twice', () => {
    expect(() => toContentHash(`sha256:${HEX}`)).toThrow('not a SHA-256 hex digest')
  })

  it('rejects a digest of the wrong length', () => {
    expect(() => toContentHash('abc123')).toThrow('not a SHA-256 hex digest')
  })
})

describe('parseContentHash', () => {
  it('keeps a prefixed hash as it is', () => {
    expect(parseContentHash(`sha256:${HEX}`)).toBe(`sha256:${HEX}`)
  })

  it('prefixes a bare hex digest', () => {
    expect(parseContentHash(HEX.toUpperCase())).toBe(`sha256:${HEX}`)
  })

  it('keeps an empty hash empty', () => {
    expect(parseContentHash('')).toBe('')
  })

  it('passes a value in no known form through unchanged', () => {
    expect(parseContentHash('md5:abc')).toBe('md5:abc')
  })
})
