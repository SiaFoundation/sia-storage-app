import { ANCHOR_START, formatAnchor, parseAnchor } from './providerAnchor'

const EPOCH = 'testepoch1'

describe('provider anchors', () => {
  it('round-trips a cursor through the wire form', () => {
    const anchor = formatAnchor(EPOCH, { feedSeq: 42, id: 'abc123' })
    expect(parseAnchor(anchor, EPOCH)).toEqual({ feedSeq: 42, id: 'abc123', startSeq: '' })
  })

  it('round-trips the fourth segment, which the parse never rejects', () => {
    const anchor = formatAnchor(EPOCH, { feedSeq: 7, id: 'x1' }, '900')
    expect(parseAnchor(anchor, EPOCH)).toEqual({ feedSeq: 7, id: 'x1', startSeq: '900' })
  })

  it('another epoch means another library, and the anchor dies with it', () => {
    const anchor = formatAnchor(EPOCH, { feedSeq: 42, id: 'abc' })
    expect(parseAnchor(anchor, 'otherepoch')).toBeNull()
  })

  it('unrecognized anchor forms expire rather than parse', () => {
    expect(parseAnchor('1757890000000:f1:12-x9', EPOCH)).toBeNull()
    expect(parseAnchor('0', EPOCH)).toBeNull()
    expect(parseAnchor('', EPOCH)).toBeNull()
  })

  it('a corrupt sequence expires instead of resuming from a guessed spot', () => {
    expect(parseAnchor(`${EPOCH}:12abc:f1`, EPOCH)).toBeNull()
    expect(parseAnchor(`${EPOCH}::f1`, EPOCH)).toBeNull()
  })

  it('the feed start formats without a fourth segment', () => {
    expect(formatAnchor(EPOCH, ANCHOR_START)).toBe(`${EPOCH}:0:`)
  })
})
