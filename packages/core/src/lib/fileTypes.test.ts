import { extFromMime, getMimeTypeFromExtension, isMimeType, MimeTypes } from './fileTypes'
import type { Ext, MimeType } from './fileTypes'

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

  describe('video extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['movie.avi', 'video/x-msvideo'],
      ['movie.mkv', 'video/x-matroska'],
      ['movie.webm', 'video/webm'],
      ['clip.3gp', 'video/3gpp'],
      ['clip.3g2', 'video/3gpp2'],
      ['movie.mpeg', 'video/mpeg'],
      ['movie.mpg', 'video/mpeg'],
      ['movie.wmv', 'video/x-ms-wmv'],
      ['movie.flv', 'video/x-flv'],
      ['movie.ogv', 'video/ogg'],
      ['movie.m4v', 'video/x-m4v'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('image extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['icon.bmp', 'image/bmp'],
      ['favicon.ico', 'image/vnd.microsoft.icon'],
      ['photo.avif', 'image/avif'],
      ['photo.jxl', 'image/jxl'],
      ['live.heics', 'image/heic-sequence'],
      ['frame.avci', 'image/avci'],
      ['frames.avcs', 'image/avcs'],
      ['design.psd', 'image/vnd.adobe.photoshop'],
      ['raw.cr2', 'image/x-canon-cr2'],
      ['raw.cr3', 'image/x-canon-cr3'],
      ['raw.nef', 'image/x-nikon-nef'],
      ['raw.nrw', 'image/x-nikon-nrw'],
      ['raw.arw', 'image/x-sony-arw'],
      ['raw.raf', 'image/x-fuji-raf'],
      ['raw.orf', 'image/x-olympus-orf'],
      ['raw.rw2', 'image/x-panasonic-rw2'],
      ['raw.pef', 'image/x-pentax-pef'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('audio extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['song.flac', 'audio/flac'],
      ['song.ogg', 'audio/ogg'],
      ['song.oga', 'audio/ogg'],
      ['song.opus', 'audio/opus'],
      ['song.aiff', 'audio/aiff'],
      ['song.aif', 'audio/aiff'],
      ['memo.caf', 'audio/x-caf'],
      ['call.amr', 'audio/amr'],
      ['song.wma', 'audio/x-ms-wma'],
      ['tune.mid', 'audio/midi'],
      ['tune.midi', 'audio/midi'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('document extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['report.doc', 'application/msword'],
      ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['budget.xls', 'application/vnd.ms-excel'],
      ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['deck.ppt', 'application/vnd.ms-powerpoint'],
      ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      ['note.rtf', 'application/rtf'],
      ['note.pages', 'application/vnd.apple.pages'],
      ['budget.numbers', 'application/vnd.apple.numbers'],
      ['deck.key', 'application/vnd.apple.keynote'],
      ['note.odt', 'application/vnd.oasis.opendocument.text'],
      ['budget.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
      ['deck.odp', 'application/vnd.oasis.opendocument.presentation'],
      ['book.epub', 'application/epub+zip'],
      ['book.mobi', 'application/x-mobipocket-ebook'],
      ['book.azw3', 'application/vnd.amazon.ebook'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('archive extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['archive.zip', 'application/zip'],
      ['archive.gz', 'application/gzip'],
      ['archive.tgz', 'application/gzip'],
      ['archive.tar', 'application/x-tar'],
      ['archive.7z', 'application/x-7z-compressed'],
      ['archive.rar', 'application/vnd.rar'],
      ['archive.bz2', 'application/x-bzip2'],
      ['archive.tbz', 'application/x-bzip2'],
      ['archive.tbz2', 'application/x-bzip2'],
      ['archive.xz', 'application/x-xz'],
      ['archive.zst', 'application/zstd'],
      ['disc.iso', 'application/x-iso9660-image'],
      ['archive.cab', 'application/vnd.ms-cab-compressed'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })

    it('compound .tar.gz extension picks gz', () => {
      expect(getMimeTypeFromExtension('archive.tar.gz')).toBe('application/gzip')
    })

    it('compound .tar.bz2 extension picks bz2', () => {
      expect(getMimeTypeFromExtension('archive.tar.bz2')).toBe('application/x-bzip2')
    })
  })

  describe('installer extensions', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['installer.dmg', 'application/x-apple-diskimage'],
      ['installer.exe', 'application/vnd.microsoft.portable-executable'],
      ['installer.msi', 'application/x-msi'],
      ['installer.deb', 'application/vnd.debian.binary-package'],
      ['installer.rpm', 'application/x-rpm'],
      ['app.apk', 'application/vnd.android.package-archive'],
      ['installer.pkg', 'application/vnd.apple.installer+xml'],
      ['app.appimage', 'application/x-iso9660-appimage'],
      ['app.snap', 'application/vnd.snap'],
      ['app.flatpak', 'application/vnd.flatpak'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('config + standardized text formats', () => {
    const cases: ReadonlyArray<readonly [string, MimeType]> = [
      ['config.yaml', 'application/yaml'],
      ['config.yml', 'application/yaml'],
      ['Cargo.toml', 'application/toml'],
    ]
    it.each(cases)('%s → %s', (path, mime) => {
      expect(getMimeTypeFromExtension(path)).toBe(mime)
    })
  })

  describe('source code extensions resolve to text/plain', () => {
    const cases: ReadonlyArray<string> = [
      'index.ts',
      'app.tsx',
      'component.jsx',
      'script.py',
      'gem.rb',
      'main.go',
      'lib.rs',
      'App.java',
      'Main.kt',
      'App.swift',
      'main.c',
      'main.h',
      'main.cpp',
      'lib.hpp',
      'Program.cs',
      'index.php',
      'init.lua',
      'build.sh',
      'build.bash',
      'init.zsh',
      'query.sql',
      'analysis.r',
      'Main.scala',
      'main.dart',
      'App.vue',
      'App.svelte',
    ]
    it.each(cases)('%s → text/plain', (path) => {
      expect(getMimeTypeFromExtension(path)).toBe('text/plain')
    })
  })

  describe('config extensions resolve to text/plain', () => {
    const cases: ReadonlyArray<string> = ['app.ini', 'app.cfg', 'app.conf', 'app.env', 'app.log']
    it.each(cases)('%s → text/plain', (path) => {
      expect(getMimeTypeFromExtension(path)).toBe('text/plain')
    })
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

  it('returns .zip for application/zip', () => {
    expect(extFromMime('application/zip')).toBe('.zip')
  })

  it('returns .bin for unknown types', () => {
    expect(extFromMime('foo/bar')).toBe('.bin')
  })

  it('returns .bin for null/undefined', () => {
    expect(extFromMime(null)).toBe('.bin')
    expect(extFromMime(undefined)).toBe('.bin')
  })

  describe('mime aliases collapse to a canonical extension', () => {
    const cases: ReadonlyArray<readonly [string, Ext]> = [
      ['video/avi', '.avi'],
      ['image/x-icon', '.ico'],
      ['image/heif-sequence', '.heics'],
    ]
    it.each(cases)('%s → %s', (mime, ext) => {
      expect(extFromMime(mime)).toBe(ext)
    })
  })

  describe('every union member has a concrete extension', () => {
    it.each(MimeTypes)('%s has a non-.bin extension (or is octet-stream)', (mime) => {
      const ext = extFromMime(mime)
      if (mime === 'application/octet-stream') {
        expect(ext).toBe('.bin')
      } else {
        expect(ext).not.toBe('.bin')
      }
    })
  })
})

describe('isMimeType', () => {
  it('returns true for known types', () => {
    expect(isMimeType('image/jpeg')).toBe(true)
    expect(isMimeType('video/mp4')).toBe(true)
    expect(isMimeType('application/octet-stream')).toBe(true)
    expect(isMimeType('text/plain')).toBe(true)
  })

  it('returns true for newly-added types', () => {
    expect(isMimeType('video/x-msvideo')).toBe(true)
    expect(isMimeType('image/bmp')).toBe(true)
    expect(isMimeType('image/avif')).toBe(true)
    expect(isMimeType('image/heic-sequence')).toBe(true)
    expect(isMimeType('audio/flac')).toBe(true)
    expect(isMimeType('application/yaml')).toBe(true)
    expect(isMimeType('application/toml')).toBe(true)
    expect(isMimeType('application/vnd.android.package-archive')).toBe(true)
  })

  it('returns false for unknown types', () => {
    expect(isMimeType('foo/bar')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isMimeType(undefined)).toBe(false)
  })
})
