import { readMetadataVersion } from './fileMetadata'

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
