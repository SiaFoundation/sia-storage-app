/**
 * The committed file-type test corpus. Each entry declares what
 * `getMimeTypeFromExtension(filename)` should return, what
 * `detectMimeType({ bytes })` should return when the extension is stripped,
 * and where the sample file came from.
 *
 * `mime` — the canonical MIME for this extension.
 *
 * `bytesMime` — what magic-byte detection produces with no extension hint.
 *   `null` for formats with no magic-byte rule (most plain-text files, niche
 *   containers without a unique signature) — the detector falls back to
 *   `application/octet-stream`. Container-based formats resolve to the
 *   container's MIME, not the vendor-specific outer MIME (e.g. `.docx` →
 *   `application/zip`, camera RAW → `image/tiff`).
 *
 * `source` — where the byte content came from:
 *   - 'small'         — github.com/mathiasbynens/small (smallest valid file).
 *   - 'format-corpus' — github.com/openpreserve/format-corpus.
 *   - 'generated'     — synthesized via ffmpeg / sips / native CLI archivers.
 *   - 'stub'          — hand-written magic-byte prefix; passes detection but
 *                       isn't a real openable file. Replace with a real sample
 *                       when convenient.
 *
 * Adding a new fixture: drop `sample.<ext>` into this directory and add a
 * matching entry below. `fileTypeFixtures.test.ts` enforces that the
 * directory listing and this map stay in sync.
 */

type FixtureSource = 'small' | 'format-corpus' | 'generated' | 'stub'

type FixtureExpectation = {
  mime: string
  bytesMime: string | null
  source: FixtureSource
}

export const fixtureExpectations = {
  // ---- Video ----
  'sample.avi': { mime: 'video/x-msvideo', bytesMime: 'video/x-msvideo', source: 'small' },
  'sample.mp4': { mime: 'video/mp4', bytesMime: 'video/mp4', source: 'small' },
  'sample.webm': { mime: 'video/webm', bytesMime: 'video/x-matroska', source: 'small' },
  'sample.wmv': { mime: 'video/x-ms-wmv', bytesMime: null, source: 'small' },
  'sample.flv': { mime: 'video/x-flv', bytesMime: null, source: 'small' },
  'sample.mov': { mime: 'video/quicktime', bytesMime: 'video/quicktime', source: 'format-corpus' },
  'sample.m4v': { mime: 'video/x-m4v', bytesMime: 'video/mp4', source: 'generated' },
  'sample.mkv': { mime: 'video/x-matroska', bytesMime: 'video/x-matroska', source: 'generated' },
  'sample.3gp': { mime: 'video/3gpp', bytesMime: 'video/mp4', source: 'generated' },
  'sample.3g2': { mime: 'video/3gpp2', bytesMime: 'video/mp4', source: 'generated' },
  'sample.mpeg': { mime: 'video/mpeg', bytesMime: null, source: 'generated' },
  'sample.mpg': { mime: 'video/mpeg', bytesMime: null, source: 'generated' },
  'sample.ogv': { mime: 'video/ogg', bytesMime: 'audio/ogg', source: 'stub' },

  // ---- Audio ----
  'sample.mp3': { mime: 'audio/mpeg', bytesMime: 'audio/mpeg', source: 'small' },
  'sample.wav': { mime: 'audio/wav', bytesMime: 'audio/wav', source: 'small' },
  'sample.m4a': { mime: 'audio/mp4', bytesMime: 'audio/mp4', source: 'generated' },
  'sample.aac': { mime: 'audio/aac', bytesMime: null, source: 'generated' },
  'sample.flac': { mime: 'audio/flac', bytesMime: 'audio/flac', source: 'generated' },
  'sample.opus': { mime: 'audio/opus', bytesMime: 'audio/ogg', source: 'generated' },
  'sample.aiff': { mime: 'audio/aiff', bytesMime: 'audio/aiff', source: 'generated' },
  'sample.caf': { mime: 'audio/x-caf', bytesMime: null, source: 'generated' },
  'sample.wma': { mime: 'audio/x-ms-wma', bytesMime: null, source: 'generated' },
  'sample.ogg': { mime: 'audio/ogg', bytesMime: 'audio/ogg', source: 'stub' },
  'sample.amr': { mime: 'audio/amr', bytesMime: null, source: 'stub' },
  'sample.midi': { mime: 'audio/midi', bytesMime: null, source: 'stub' },

  // ---- Image ----
  'sample.jpg': { mime: 'image/jpeg', bytesMime: 'image/jpeg', source: 'small' },
  'sample.png': { mime: 'image/png', bytesMime: 'image/png', source: 'small' },
  'sample.gif': { mime: 'image/gif', bytesMime: 'image/gif', source: 'small' },
  'sample.webp': { mime: 'image/webp', bytesMime: 'image/webp', source: 'small' },
  'sample.bmp': { mime: 'image/bmp', bytesMime: 'image/bmp', source: 'small' },
  'sample.tiff': { mime: 'image/tiff', bytesMime: 'image/tiff', source: 'small' },
  'sample.ico': { mime: 'image/vnd.microsoft.icon', bytesMime: null, source: 'small' },
  'sample.heif': { mime: 'image/heif', bytesMime: 'image/heic', source: 'small' },
  'sample.jxl': { mime: 'image/jxl', bytesMime: null, source: 'small' },
  'sample.svg': { mime: 'image/svg+xml', bytesMime: null, source: 'small' },
  'sample.heic': { mime: 'image/heic', bytesMime: 'image/heic', source: 'generated' },
  'sample.psd': { mime: 'image/vnd.adobe.photoshop', bytesMime: null, source: 'generated' },
  'sample.avif': { mime: 'image/avif', bytesMime: 'image/avif', source: 'stub' },
  'sample.dng': { mime: 'image/dng', bytesMime: 'image/tiff', source: 'stub' },
  'sample.heics': { mime: 'image/heic-sequence', bytesMime: null, source: 'stub' },
  'sample.avci': { mime: 'image/avci', bytesMime: null, source: 'stub' },
  'sample.avcs': { mime: 'image/avcs', bytesMime: null, source: 'stub' },
  'sample.cr2': { mime: 'image/x-canon-cr2', bytesMime: 'image/tiff', source: 'stub' },
  'sample.cr3': { mime: 'image/x-canon-cr3', bytesMime: 'image/tiff', source: 'stub' },
  'sample.nef': { mime: 'image/x-nikon-nef', bytesMime: 'image/tiff', source: 'stub' },
  'sample.nrw': { mime: 'image/x-nikon-nrw', bytesMime: 'image/tiff', source: 'stub' },
  'sample.arw': { mime: 'image/x-sony-arw', bytesMime: 'image/tiff', source: 'stub' },
  'sample.raf': { mime: 'image/x-fuji-raf', bytesMime: 'image/tiff', source: 'stub' },
  'sample.orf': { mime: 'image/x-olympus-orf', bytesMime: 'image/tiff', source: 'stub' },
  'sample.rw2': { mime: 'image/x-panasonic-rw2', bytesMime: 'image/tiff', source: 'stub' },
  'sample.pef': { mime: 'image/x-pentax-pef', bytesMime: 'image/tiff', source: 'stub' },

  // ---- Documents ----
  'sample.pdf': { mime: 'application/pdf', bytesMime: 'application/pdf', source: 'small' },
  'sample.rtf': { mime: 'application/rtf', bytesMime: null, source: 'small' },
  'sample.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.doc': { mime: 'application/msword', bytesMime: null, source: 'format-corpus' },
  'sample.xls': { mime: 'application/vnd.ms-excel', bytesMime: null, source: 'format-corpus' },
  'sample.ppt': {
    mime: 'application/vnd.ms-powerpoint',
    bytesMime: null,
    source: 'format-corpus',
  },
  'sample.odt': {
    mime: 'application/vnd.oasis.opendocument.text',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.ods': {
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.odp': {
    mime: 'application/vnd.oasis.opendocument.presentation',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.pages': {
    mime: 'application/vnd.apple.pages',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.epub': {
    mime: 'application/epub+zip',
    bytesMime: 'application/zip',
    source: 'format-corpus',
  },
  'sample.mobi': {
    mime: 'application/x-mobipocket-ebook',
    bytesMime: null,
    source: 'format-corpus',
  },
  'sample.azw3': {
    mime: 'application/vnd.amazon.ebook',
    bytesMime: null,
    source: 'format-corpus',
  },
  'sample.xlsx': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytesMime: 'application/zip',
    source: 'stub',
  },
  'sample.pptx': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    bytesMime: 'application/zip',
    source: 'stub',
  },
  'sample.numbers': {
    mime: 'application/vnd.apple.numbers',
    bytesMime: 'application/zip',
    source: 'stub',
  },
  'sample.key': {
    mime: 'application/vnd.apple.keynote',
    bytesMime: 'application/zip',
    source: 'stub',
  },

  // ---- Archives ----
  'sample.zip': { mime: 'application/zip', bytesMime: 'application/zip', source: 'small' },
  'sample.tar': { mime: 'application/x-tar', bytesMime: null, source: 'small' },
  'sample.gz': { mime: 'application/gzip', bytesMime: 'application/gzip', source: 'small' },
  'sample.bz2': { mime: 'application/x-bzip2', bytesMime: 'application/x-bzip2', source: 'small' },
  'sample.rar': { mime: 'application/vnd.rar', bytesMime: 'application/vnd.rar', source: 'small' },
  'sample.tgz': { mime: 'application/gzip', bytesMime: 'application/gzip', source: 'generated' },
  'sample.tbz': {
    mime: 'application/x-bzip2',
    bytesMime: 'application/x-bzip2',
    source: 'generated',
  },
  'sample.tbz2': {
    mime: 'application/x-bzip2',
    bytesMime: 'application/x-bzip2',
    source: 'generated',
  },
  'sample.xz': { mime: 'application/x-xz', bytesMime: 'application/x-xz', source: 'generated' },
  'sample.zst': { mime: 'application/zstd', bytesMime: null, source: 'generated' },
  'sample.7z': {
    mime: 'application/x-7z-compressed',
    bytesMime: 'application/x-7z-compressed',
    source: 'stub',
  },
  'sample.iso': { mime: 'application/x-iso9660-image', bytesMime: null, source: 'stub' },
  'sample.cab': { mime: 'application/vnd.ms-cab-compressed', bytesMime: null, source: 'stub' },

  // ---- Installers ----
  'sample.exe': {
    mime: 'application/vnd.microsoft.portable-executable',
    bytesMime: null,
    source: 'small',
  },
  'sample.msi': { mime: 'application/x-msi', bytesMime: null, source: 'stub' },
  'sample.dmg': { mime: 'application/x-apple-diskimage', bytesMime: null, source: 'stub' },
  'sample.deb': { mime: 'application/vnd.debian.binary-package', bytesMime: null, source: 'stub' },
  'sample.rpm': { mime: 'application/x-rpm', bytesMime: null, source: 'stub' },
  'sample.apk': {
    mime: 'application/vnd.android.package-archive',
    bytesMime: 'application/zip',
    source: 'stub',
  },
  'sample.pkg': { mime: 'application/vnd.apple.installer+xml', bytesMime: null, source: 'stub' },
  'sample.appimage': { mime: 'application/x-iso9660-appimage', bytesMime: null, source: 'stub' },
  'sample.snap': { mime: 'application/vnd.snap', bytesMime: null, source: 'stub' },
  'sample.flatpak': { mime: 'application/vnd.flatpak', bytesMime: null, source: 'stub' },

  // ---- Structured text MIMEs ----
  'sample.md': { mime: 'text/markdown', bytesMime: null, source: 'small' },
  'sample.html': { mime: 'text/html', bytesMime: null, source: 'small' },
  'sample.css': { mime: 'text/css', bytesMime: null, source: 'small' },
  'sample.js': { mime: 'text/javascript', bytesMime: null, source: 'small' },
  'sample.json': { mime: 'application/json', bytesMime: null, source: 'small' },
  'sample.xml': { mime: 'text/xml', bytesMime: null, source: 'small' },
  'sample.yml': { mime: 'application/yaml', bytesMime: null, source: 'small' },
  'sample.toml': { mime: 'application/toml', bytesMime: null, source: 'small' },
  'sample.txt': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.csv': { mime: 'text/csv', bytesMime: null, source: 'generated' },
  'sample.yaml': { mime: 'application/yaml', bytesMime: null, source: 'generated' },

  // ---- Source code (all resolve to text/plain) ----
  'sample.ts': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.tsx': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.jsx': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.py': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.rb': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.go': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.rs': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.java': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.kt': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.swift': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.c': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.h': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.cpp': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.hpp': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.cs': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.php': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.lua': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.sh': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.bash': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.zsh': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.sql': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.r': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.scala': { mime: 'text/plain', bytesMime: null, source: 'small' },
  'sample.dart': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.vue': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.svelte': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.ini': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.cfg': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.conf': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.env': { mime: 'text/plain', bytesMime: null, source: 'generated' },
  'sample.log': { mime: 'text/plain', bytesMime: null, source: 'generated' },
} as const satisfies Record<string, FixtureExpectation>

export type FixtureName = keyof typeof fixtureExpectations
