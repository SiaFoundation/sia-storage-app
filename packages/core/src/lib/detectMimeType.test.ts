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

  describe('magic-byte rules for newly-supported formats', () => {
    it('detects AVI from RIFF…AVI ', () => {
      const aviBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
      ])
      expect(detectMimeType({ bytes: aviBytes })).toBe('video/x-msvideo')
    })

    it('still detects WAV from RIFF…WAVE alongside the AVI rule', () => {
      const wavBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ])
      expect(detectMimeType({ bytes: wavBytes })).toBe('audio/wav')
    })

    it('detects AIFF from FORM…AIFF', () => {
      const aiffBytes = new Uint8Array([
        0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x46,
      ])
      expect(detectMimeType({ bytes: aiffBytes })).toBe('audio/aiff')
    })

    it('detects AIFC (compressed AIFF) from FORM…AIFC', () => {
      const aifcBytes = new Uint8Array([
        0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x43,
      ])
      expect(detectMimeType({ bytes: aifcBytes })).toBe('audio/aiff')
    })

    it('detects FLAC from "fLaC"', () => {
      const flacBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43])
      expect(detectMimeType({ bytes: flacBytes })).toBe('audio/flac')
    })

    it('detects OGG from "OggS"', () => {
      const oggBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53])
      expect(detectMimeType({ bytes: oggBytes })).toBe('audio/ogg')
    })

    it('detects MKV/EBML', () => {
      const mkvBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
      expect(detectMimeType({ bytes: mkvBytes })).toBe('video/x-matroska')
    })

    it('detects 7z', () => {
      const sevenZ = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
      expect(detectMimeType({ bytes: sevenZ })).toBe('application/x-7z-compressed')
    })

    it('detects bzip2 from "BZh"', () => {
      const bzBytes = new Uint8Array([0x42, 0x5a, 0x68, 0x39])
      expect(detectMimeType({ bytes: bzBytes })).toBe('application/x-bzip2')
    })

    it('detects xz', () => {
      const xzBytes = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
      expect(detectMimeType({ bytes: xzBytes })).toBe('application/x-xz')
    })

    it('detects RAR v1.5+ ("Rar!\\x1A\\x07\\x00")', () => {
      const rarBytes = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
      expect(detectMimeType({ bytes: rarBytes })).toBe('application/vnd.rar')
    })

    it('detects RAR v5 ("Rar!\\x1A\\x07\\x01")', () => {
      const rarBytes = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
      expect(detectMimeType({ bytes: rarBytes })).toBe('application/vnd.rar')
    })

    it('detects ZIP', () => {
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
      expect(detectMimeType({ bytes: zipBytes })).toBe('application/zip')
    })

    it('detects gzip', () => {
      const gzBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00])
      expect(detectMimeType({ bytes: gzBytes })).toBe('application/gzip')
    })

    it('detects MP3 across version variants', () => {
      // MPEG-1 Layer 3 (0xFB), MPEG-2 Layer 3 (0xF3), MPEG-2.5 Layer 3 (0xE3)
      for (const b1 of [0xfb, 0xf3, 0xe3]) {
        const mp3 = new Uint8Array([0xff, b1, 0x00, 0x00])
        expect(detectMimeType({ bytes: mp3 })).toBe('audio/mpeg')
      }
    })

    it('does not misidentify AAC ADTS as MP3', () => {
      // AAC ADTS sync (0xFF F1 / 0xFF F9) shares the 11-bit sync prefix but
      // carries layer=00 (reserved for MPEG audio).
      for (const b1 of [0xf1, 0xf9]) {
        const aac = new Uint8Array([0xff, b1, 0x50, 0x40])
        expect(detectMimeType({ bytes: aac })).toBe('application/octet-stream')
      }
    })

    it('detects ZIP empty-archive marker (PK\\x05\\x06)', () => {
      const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06])
      expect(detectMimeType({ bytes: empty })).toBe('application/zip')
    })

    it('detects ZIP spanned-archive data descriptor (PK\\x07\\x08)', () => {
      const spanned = new Uint8Array([0x50, 0x4b, 0x07, 0x08])
      expect(detectMimeType({ bytes: spanned })).toBe('application/zip')
    })

    it('rejects PK prefixes with mismatched second byte', () => {
      // Only PK 03 04, PK 05 06, PK 07 08 are valid. The other six combinations
      // are not ZIP and must not be misidentified.
      for (const [b2, b3] of [
        [0x03, 0x06],
        [0x03, 0x08],
        [0x05, 0x04],
        [0x05, 0x08],
        [0x07, 0x04],
        [0x07, 0x06],
      ]) {
        const bytes = new Uint8Array([0x50, 0x4b, b2, b3])
        expect(detectMimeType({ bytes })).not.toBe('application/zip')
      }
    })

    it('detects 3GP-family brands as MP4-container video', () => {
      // 3gp4, 3g2a — the standard 3GPP and 3GPP2 base brands.
      const make = (brand: string) =>
        new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x1c,
          0x66,
          0x74,
          0x79,
          0x70,
          brand.charCodeAt(0),
          brand.charCodeAt(1),
          brand.charCodeAt(2),
          brand.charCodeAt(3),
        ])
      expect(detectMimeType({ bytes: make('3gp4') })).toBe('video/mp4')
      expect(detectMimeType({ bytes: make('3g2a') })).toBe('video/mp4')
    })
  })

  describe('priority chain with new types', () => {
    it('honors providedType=video/x-msvideo now that it is in the union', () => {
      expect(detectMimeType({ providedType: 'video/x-msvideo' })).toBe('video/x-msvideo')
    })

    it('falls back to magic bytes when providedType is unknown and no extension', () => {
      const aviBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
      ])
      expect(detectMimeType({ providedType: 'foo/bar', bytes: aviBytes })).toBe('video/x-msvideo')
    })
  })
})
