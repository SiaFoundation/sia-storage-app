import { ANCHOR_START, folderFingerprint, formatAnchor, parseAnchor } from './providerAnchor'

describe('the anchor round trip', () => {
  it('carries the cursor and the fingerprint through a round trip', () => {
    const folders = folderFingerprint(['d1', 'd2'])
    const raw = formatAnchor({ updatedAt: 1234, id: 'abc9' }, folders)

    expect(parseAnchor(raw)).toEqual({ updatedAt: 1234, id: 'abc9', folders })
  })

  it('survives an id containing the delimiter', () => {
    const raw = formatAnchor({ updatedAt: 5, id: 'a:b:c' }, '2-xyz')

    expect(parseAnchor(raw)).toEqual({ updatedAt: 5, id: 'a:b:c', folders: '2-xyz' })
  })

  it('reads an anchor with no folder field as one that never expires', () => {
    expect(parseAnchor('42:abc')).toEqual({ updatedAt: 42, id: 'abc', folders: '' })
    expect(parseAnchor('42')).toEqual({ updatedAt: 42, id: '', folders: '' })
  })

  it('starts from the beginning on an unreadable anchor', () => {
    expect(parseAnchor('')).toEqual(ANCHOR_START)
    expect(parseAnchor('soon:x:y')).toEqual(ANCHOR_START)
    expect(parseAnchor('-1:x:y')).toEqual(ANCHOR_START)
  })
})

describe('the folder fingerprint', () => {
  it('ignores order', () => {
    expect(folderFingerprint(['a', 'b', 'c'])).toBe(folderFingerprint(['c', 'a', 'b']))
  })

  it('tells apart sets a hash alone could confuse', () => {
    expect(folderFingerprint(['a'])).not.toBe(folderFingerprint(['b']))
    expect(folderFingerprint(['a'])).not.toBe(folderFingerprint(['a', 'b']))
  })

  it('never contains the anchor delimiter', () => {
    expect(folderFingerprint(['a:b', 'c'])).not.toContain(':')
  })

  it('starts over for a clock that is only partly a number', () => {
    expect(parseAnchor('12abc:f1:2-x')).toEqual(ANCHOR_START)
  })
})
