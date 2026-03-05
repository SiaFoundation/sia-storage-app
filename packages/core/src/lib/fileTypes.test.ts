import { extFromMime, getMimeTypeFromExtension, isMimeType } from './fileTypes'

describe('getMimeTypeFromExtension', () => {
  it('returns correct type for known extensions', () => {
    expect(getMimeTypeFromExtension('photo.jpg')).toBe('image/jpeg')
    expect(getMimeTypeFromExtension('photo.jpeg')).toBe('image/jpeg')
    expect(getMimeTypeFromExtension('image.png')).toBe('image/png')
    expect(getMimeTypeFromExtension('video.mp4')).toBe('video/mp4')
    expect(getMimeTypeFromExtension('video.mov')).toBe('video/quicktime')
    expect(getMimeTypeFromExtension('song.mp3')).toBe('audio/mpeg')
    expect(getMimeTypeFromExtension('doc.pdf')).toBe('application/pdf')
    expect(getMimeTypeFromExtension('data.json')).toBe('application/json')
    expect(getMimeTypeFromExtension('notes.md')).toBe('text/markdown')
    expect(getMimeTypeFromExtension('notes.txt')).toBe('text/plain')
  })

  it('is case insensitive', () => {
    expect(getMimeTypeFromExtension('photo.JPG')).toBe('image/jpeg')
    expect(getMimeTypeFromExtension('photo.Png')).toBe('image/png')
    expect(getMimeTypeFromExtension('video.MP4')).toBe('video/mp4')
  })

  it('returns null for unknown extensions', () => {
    expect(getMimeTypeFromExtension('file.xyz')).toBeNull()
    expect(getMimeTypeFromExtension('file.foo')).toBeNull()
  })

  it('returns null for undefined/empty input', () => {
    expect(getMimeTypeFromExtension(undefined)).toBeNull()
    expect(getMimeTypeFromExtension('')).toBeNull()
  })

  it('handles paths with query strings and fragments', () => {
    expect(getMimeTypeFromExtension('photo.jpg?v=1')).toBe('image/jpeg')
    expect(getMimeTypeFromExtension('photo.png#section')).toBe('image/png')
  })

  it('handles full paths', () => {
    expect(getMimeTypeFromExtension('/path/to/photo.jpg')).toBe('image/jpeg')
    expect(getMimeTypeFromExtension('file:///tmp/video.mp4')).toBe('video/mp4')
  })
})

describe('extFromMime', () => {
  it('returns correct extension for known types', () => {
    expect(extFromMime('image/jpeg')).toBe('.jpg')
    expect(extFromMime('image/png')).toBe('.png')
    expect(extFromMime('video/mp4')).toBe('.mp4')
    expect(extFromMime('video/quicktime')).toBe('.mov')
    expect(extFromMime('audio/mpeg')).toBe('.mp3')
    expect(extFromMime('application/pdf')).toBe('.pdf')
    expect(extFromMime('text/markdown')).toBe('.md')
    expect(extFromMime('text/x-markdown')).toBe('.md')
  })

  it('returns .dng for DNG variants', () => {
    expect(extFromMime('image/dng')).toBe('.dng')
    expect(extFromMime('image/x-adobe-dng')).toBe('.dng')
    expect(extFromMime('image/x-apple-proraw')).toBe('.dng')
  })

  it('returns .m4a for audio/mp4 and audio/x-m4a', () => {
    expect(extFromMime('audio/mp4')).toBe('.m4a')
    expect(extFromMime('audio/x-m4a')).toBe('.m4a')
  })

  it('returns .bin for unknown types', () => {
    expect(extFromMime('application/zip')).toBe('.bin')
    expect(extFromMime('foo/bar')).toBe('.bin')
  })

  it('returns .bin for null/undefined', () => {
    expect(extFromMime(null)).toBe('.bin')
    expect(extFromMime(undefined)).toBe('.bin')
  })
})

describe('isMimeType', () => {
  it('returns true for known types', () => {
    expect(isMimeType('image/jpeg')).toBe(true)
    expect(isMimeType('video/mp4')).toBe(true)
    expect(isMimeType('application/octet-stream')).toBe(true)
    expect(isMimeType('text/plain')).toBe(true)
  })

  it('returns false for unknown types', () => {
    expect(isMimeType('image/bmp')).toBe(false)
    expect(isMimeType('foo/bar')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isMimeType(undefined)).toBe(false)
  })
})
