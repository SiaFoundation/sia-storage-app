import { decodeFileMetadata, encodeFileMetadata, readMetadataVersion } from './fileMetadata'

describe('readMetadataVersion', () => {
  const encode = (obj: unknown) =>
    new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer

  it('reads a numeric version', () => {
    expect(readMetadataVersion(encode({ version: 3 }))).toBe(3)
  })

  it('returns 0 for an absent buffer', () => {
    expect(readMetadataVersion(undefined)).toBe(0)
  })

  it('returns 0 for an unparseable buffer', () => {
    expect(readMetadataVersion(new TextEncoder().encode('not json').buffer as ArrayBuffer)).toBe(0)
  })

  it('returns 0 when version is missing or non-numeric', () => {
    expect(readMetadataVersion(encode({}))).toBe(0)
    expect(readMetadataVersion(encode({ version: 'x' }))).toBe(0)
  })
})

describe('decodeFileMetadata', () => {
  const encode = (obj: unknown) =>
    new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer
  const fields = { version: 1, id: 'f1', name: 'a.txt', type: 'text/plain', kind: 'file' }

  it('prefixes a bare hex hash, the form sia add publishes', () => {
    const hex = 'ab'.repeat(32)
    const meta = decodeFileMetadata(
      encode({ ...fields, size: 1, hash: hex, createdAt: 1, updatedAt: 1, trashedAt: null }),
    )
    expect(meta.hash).toBe(`sha256:${hex}`)
  })
})

describe('encodeFileMetadata', () => {
  const file = {
    id: 'f1',
    name: 'a.txt',
    type: 'text/plain',
    kind: 'file' as const,
    size: 1,
    hash: 'sha256:h' as const,
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
  }

  it('writes a root file with an empty directory and no tags, so peers can apply both', () => {
    const decoded = decodeFileMetadata(encodeFileMetadata(file))
    expect(decoded.directory).toBe('')
    expect(decoded.tags).toEqual([])
  })

  it('writes a file’s directory and tags as they are', () => {
    const decoded = decodeFileMetadata(
      encodeFileMetadata({ ...file, directory: 'docs', tags: ['keep'] }),
    )
    expect(decoded.directory).toBe('docs')
    expect(decoded.tags).toEqual(['keep'])
  })
})
