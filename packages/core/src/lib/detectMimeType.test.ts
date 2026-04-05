import { detectMimeType } from './detectMimeType'

describe('detectMimeType', () => {
  it('returns providedType when recognized', () => {
    expect(detectMimeType({ providedType: 'image/jpeg' })).toBe('image/jpeg')
    expect(detectMimeType({ providedType: 'video/mp4' })).toBe('video/mp4')
    expect(detectMimeType({ providedType: 'application/pdf' })).toBe('application/pdf')
  })

  it('ignores unrecognized providedType and falls through to extension', () => {
    expect(detectMimeType({ providedType: 'foo/bar', fileName: 'photo.jpg' })).toBe('image/jpeg')
  })

  it('falls through to extension when providedType is null', () => {
    expect(detectMimeType({ providedType: null, fileName: 'photo.png' })).toBe('image/png')
  })

  it('detects type from fileName extension', () => {
    expect(detectMimeType({ fileName: 'video.mp4' })).toBe('video/mp4')
    expect(detectMimeType({ fileName: 'song.mp3' })).toBe('audio/mpeg')
    expect(detectMimeType({ fileName: 'doc.pdf' })).toBe('application/pdf')
  })

  it('detects type from magic bytes (JPEG)', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(detectMimeType({ bytes: jpegBytes })).toBe('image/jpeg')
  })

  it('detects type from magic bytes (PNG)', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectMimeType({ bytes: pngBytes })).toBe('image/png')
  })

  it('detects type from magic bytes (GIF)', () => {
    const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38])
    expect(detectMimeType({ bytes: gifBytes })).toBe('image/gif')
  })

  it('detects type from magic bytes (PDF)', () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    expect(detectMimeType({ bytes: pdfBytes })).toBe('application/pdf')
  })

  it('prioritizes providedType over extension', () => {
    expect(detectMimeType({ providedType: 'image/png', fileName: 'photo.jpg' })).toBe('image/png')
  })

  it('prioritizes extension over bytes', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(detectMimeType({ fileName: 'image.png', bytes: jpegBytes })).toBe('image/png')
  })

  it('prioritizes providedType over extension over bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(
      detectMimeType({
        providedType: 'video/mp4',
        fileName: 'photo.jpg',
        bytes: pngBytes,
      }),
    ).toBe('video/mp4')
  })

  it('returns application/octet-stream when no signals are provided', () => {
    expect(detectMimeType({})).toBe('application/octet-stream')
  })

  it('returns application/octet-stream when all signals are null', () => {
    expect(detectMimeType({ providedType: null, fileName: null, bytes: null })).toBe(
      'application/octet-stream',
    )
  })

  it('returns application/octet-stream for unknown extension and no bytes', () => {
    expect(detectMimeType({ fileName: 'file.xyz' })).toBe('application/octet-stream')
  })

  it('falls through unrecognized bytes to octet-stream', () => {
    const randomBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(detectMimeType({ bytes: randomBytes })).toBe('application/octet-stream')
  })
})
