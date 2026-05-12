import { shouldReplaceType } from './thumbnailScanner'

describe('shouldReplaceType', () => {
  it('returns false when declared and detected match', () => {
    expect(shouldReplaceType('image/jpeg', 'image/jpeg')).toBe(false)
  })

  it('returns false when detected is not a recognized MIME type', () => {
    expect(shouldReplaceType('image/jpeg', 'application/x-not-a-mime')).toBe(false)
  })

  it('returns true when declared is application/octet-stream and detected is recognized', () => {
    expect(shouldReplaceType('application/octet-stream', 'image/jpeg')).toBe(true)
  })

  it('returns true when declared is not a recognized MIME type', () => {
    expect(shouldReplaceType('application/x-not-a-mime', 'image/jpeg')).toBe(true)
  })

  it('returns false when declared and detected map to the same extension (sniffer drift)', () => {
    // audio/mp4 and audio/x-m4a both -> .m4a — common drift between
    // sniffers that disagree on the alias for an MPEG-4 audio container.
    expect(shouldReplaceType('audio/mp4', 'audio/x-m4a')).toBe(false)
  })

  it('returns true when declared and detected map to different extensions', () => {
    expect(shouldReplaceType('image/heic', 'image/jpeg')).toBe(true)
  })
})
