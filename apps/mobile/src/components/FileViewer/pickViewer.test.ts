import { pickViewerForFile } from './pickViewer'

describe('pickViewerForFile', () => {
  describe('viewable image MIMEs route to ImageViewer', () => {
    const cases = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/heic',
      'image/heif',
      'image/avif',
      'image/dng',
      'image/x-adobe-dng',
      'image/x-apple-proraw',
      'image/svg+xml',
      'image/vnd.microsoft.icon',
    ]
    it.each(cases)('%s → image', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('image')
    })
  })

  describe('unrenderable image MIMEs fall through to unsupported', () => {
    const cases = [
      'image/x-canon-cr2',
      'image/x-canon-cr3',
      'image/x-nikon-nef',
      'image/x-sony-arw',
      'image/x-fuji-raf',
      'image/x-olympus-orf',
      'image/x-panasonic-rw2',
      'image/x-pentax-pef',
      'image/jxl',
      'image/vnd.adobe.photoshop',
      'image/heic-sequence',
      'image/avci',
      'image/avcs',
      'image/tiff',
    ]
    it.each(cases)('%s → unsupported', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('unsupported')
    })
  })

  describe('playable video MIMEs route to VideoPlayer', () => {
    const cases = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/3gpp2']
    it.each(cases)('%s → video', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('video')
    })
  })

  describe('unplayable video MIMEs fall through to unsupported', () => {
    const cases = [
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
      'video/mpeg',
      'video/x-ms-wmv',
      'video/x-flv',
      'video/ogg',
    ]
    it.each(cases)('%s → unsupported', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('unsupported')
    })
  })

  describe('playable audio MIMEs route to AudioPlayer', () => {
    const cases = [
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/wav',
      'audio/flac',
      'audio/ogg',
      'audio/opus',
      'audio/aiff',
      'audio/x-caf',
    ]
    it.each(cases)('%s → audio', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('audio')
    })
  })

  describe('unplayable audio MIMEs fall through to unsupported', () => {
    const cases = ['audio/x-ms-wma', 'audio/amr', 'audio/midi']
    it.each(cases)('%s → unsupported', (mime) => {
      expect(pickViewerForFile(mime, 'file')).toBe('unsupported')
    })
  })

  describe('PDF', () => {
    it('routes via MIME', () => {
      expect(pickViewerForFile('application/pdf', 'file')).toBe('pdf')
    })
    it('routes via filename when MIME is missing', () => {
      expect(pickViewerForFile(null, 'book.pdf')).toBe('pdf')
    })
    it('routes via filename when MIME is octet-stream', () => {
      expect(pickViewerForFile('application/octet-stream', 'book.pdf')).toBe('pdf')
    })
  })

  describe('JSON', () => {
    it('routes via MIME', () => {
      expect(pickViewerForFile('application/json', 'data')).toBe('json')
    })
    it('routes via filename', () => {
      expect(pickViewerForFile(null, 'data.json')).toBe('json')
    })
  })

  describe('Markdown', () => {
    it('routes via MIME', () => {
      expect(pickViewerForFile('text/markdown', 'notes')).toBe('markdown')
    })
    it('routes via x-markdown alias', () => {
      expect(pickViewerForFile('text/x-markdown', 'notes')).toBe('markdown')
    })
    it('routes via .md filename', () => {
      expect(pickViewerForFile(null, 'README.md')).toBe('markdown')
    })
    it('routes via .markdown filename', () => {
      expect(pickViewerForFile(null, 'notes.markdown')).toBe('markdown')
    })
  })

  describe('Text', () => {
    const mimeCases: [string, string][] = [
      ['text/plain', 'notes'],
      ['text/csv', 'data'],
      ['text/xml', 'feed'],
      ['application/xml', 'feed'],
      ['text/html', 'page'],
      ['text/css', 'styles'],
      ['text/javascript', 'script'],
      ['application/yaml', 'config'],
      ['application/toml', 'Cargo'],
    ]
    it.each(mimeCases)('routes %s → text', (mime, name) => {
      expect(pickViewerForFile(mime, name)).toBe('text')
    })

    const filenameCases: [string][] = [
      ['notes.txt'],
      ['data.csv'],
      ['feed.xml'],
      ['page.html'],
      ['page.htm'],
      ['styles.css'],
      ['script.js'],
    ]
    it.each(filenameCases)('routes filename %s → text (MIME missing)', (name) => {
      expect(pickViewerForFile(null, name)).toBe('text')
    })

    it('routes a .py file once its extension resolves to text/plain', () => {
      // The extension map sets text/plain for .py; pickViewer sees text/plain.
      expect(pickViewerForFile('text/plain', 'script.py')).toBe('text')
    })
  })

  describe('unsupported', () => {
    const cases = [
      ['application/zip', 'archive.zip'],
      ['application/x-bzip2', 'archive.bz2'],
      ['application/vnd.android.package-archive', 'app.apk'],
      ['application/msword', 'report.doc'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx'],
      ['application/octet-stream', 'unknown.bin'],
      [null, 'unknown.xyz'],
      [undefined, undefined],
    ] as const
    it.each(cases)('%s + %s → unsupported', (mime, name) => {
      expect(pickViewerForFile(mime, name)).toBe('unsupported')
    })
  })

  it('is case-insensitive on filenames', () => {
    expect(pickViewerForFile(null, 'README.MD')).toBe('markdown')
    expect(pickViewerForFile(null, 'BOOK.PDF')).toBe('pdf')
  })
})
