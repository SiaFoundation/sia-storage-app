export const MimeTypes = [
  // video
  'video/quicktime',
  'video/mp4',
  'video/x-m4v',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
  'video/mpeg',
  'video/x-ms-wmv',
  'video/x-flv',
  'video/ogg',
  // image
  'image/dng',
  'image/x-adobe-dng',
  'image/x-apple-proraw',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/avci',
  'image/avcs',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'image/vnd.microsoft.icon',
  'image/avif',
  'image/jxl',
  'image/vnd.adobe.photoshop',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-nikon-nrw',
  'image/x-sony-arw',
  'image/x-fuji-raf',
  'image/x-olympus-orf',
  'image/x-panasonic-rw2',
  'image/x-pentax-pef',
  // audio
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
  'audio/amr',
  'audio/x-ms-wma',
  'audio/midi',
  // text/docs
  'text/html',
  'text/css',
  'text/javascript',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/xml',
  'text/csv',
  'application/json',
  'application/yaml',
  'application/toml',
  'application/pdf',
  'image/svg+xml',
  // office / iwork / opendocument
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'application/vnd.apple.pages',
  'application/vnd.apple.numbers',
  'application/vnd.apple.keynote',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
  // archives
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/x-iso9660-image',
  'application/vnd.ms-cab-compressed',
  // installers/packages
  'application/x-apple-diskimage',
  'application/vnd.microsoft.portable-executable',
  'application/x-msi',
  'application/vnd.debian.binary-package',
  'application/x-rpm',
  'application/vnd.android.package-archive',
  'application/vnd.apple.installer+xml',
  'application/x-iso9660-appimage',
  'application/vnd.snap',
  'application/vnd.flatpak',
  // other
  'application/octet-stream',
] as const

export type MimeType = (typeof MimeTypes)[number]

export type Ext =
  // video
  | '.mov'
  | '.mp4'
  | '.m4v'
  | '.avi'
  | '.mkv'
  | '.webm'
  | '.3gp'
  | '.3g2'
  | '.mpeg'
  | '.wmv'
  | '.flv'
  | '.ogv'
  // image
  | '.dng'
  | '.heic'
  | '.heif'
  | '.heics'
  | '.avci'
  | '.avcs'
  | '.jpg'
  | '.png'
  | '.webp'
  | '.gif'
  | '.tiff'
  | '.bmp'
  | '.ico'
  | '.avif'
  | '.jxl'
  | '.psd'
  | '.cr2'
  | '.cr3'
  | '.nef'
  | '.nrw'
  | '.arw'
  | '.raf'
  | '.orf'
  | '.rw2'
  | '.pef'
  // audio
  | '.mp3'
  | '.m4a'
  | '.aac'
  | '.wav'
  | '.flac'
  | '.ogg'
  | '.opus'
  | '.aiff'
  | '.caf'
  | '.amr'
  | '.wma'
  | '.midi'
  // text/docs
  | '.html'
  | '.css'
  | '.js'
  | '.txt'
  | '.md'
  | '.json'
  | '.yaml'
  | '.toml'
  | '.pdf'
  | '.xml'
  | '.csv'
  | '.svg'
  // office / iwork / opendocument
  | '.doc'
  | '.docx'
  | '.xls'
  | '.xlsx'
  | '.ppt'
  | '.pptx'
  | '.rtf'
  | '.pages'
  | '.numbers'
  | '.key'
  | '.odt'
  | '.ods'
  | '.odp'
  | '.epub'
  | '.mobi'
  | '.azw3'
  // archives
  | '.zip'
  | '.gz'
  | '.tar'
  | '.7z'
  | '.rar'
  | '.bz2'
  | '.xz'
  | '.zst'
  | '.iso'
  | '.cab'
  // installers
  | '.dmg'
  | '.exe'
  | '.msi'
  | '.deb'
  | '.rpm'
  | '.apk'
  | '.pkg'
  | '.appimage'
  | '.snap'
  | '.flatpak'
  // other
  | '.bin'

const extensionToMimeMap: Record<string, MimeType> = {
  // video
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  // image
  dng: 'image/dng',
  heic: 'image/heic',
  heif: 'image/heif',
  heics: 'image/heic-sequence',
  avci: 'image/avci',
  avcs: 'image/avcs',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
  ico: 'image/vnd.microsoft.icon',
  avif: 'image/avif',
  jxl: 'image/jxl',
  psd: 'image/vnd.adobe.photoshop',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  nrw: 'image/x-nikon-nrw',
  arw: 'image/x-sony-arw',
  raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
  pef: 'image/x-pentax-pef',
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  caf: 'audio/x-caf',
  amr: 'audio/amr',
  wma: 'audio/x-ms-wma',
  mid: 'audio/midi',
  midi: 'audio/midi',
  // text/docs
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  pdf: 'application/pdf',
  xml: 'text/xml',
  csv: 'text/csv',
  svg: 'image/svg+xml',
  // office / iwork / opendocument
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
  key: 'application/vnd.apple.keynote',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  // archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  bz2: 'application/x-bzip2',
  tbz: 'application/x-bzip2',
  tbz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  zst: 'application/zstd',
  iso: 'application/x-iso9660-image',
  cab: 'application/vnd.ms-cab-compressed',
  // installers/packages
  dmg: 'application/x-apple-diskimage',
  exe: 'application/vnd.microsoft.portable-executable',
  msi: 'application/x-msi',
  deb: 'application/vnd.debian.binary-package',
  rpm: 'application/x-rpm',
  apk: 'application/vnd.android.package-archive',
  pkg: 'application/vnd.apple.installer+xml',
  appimage: 'application/x-iso9660-appimage',
  snap: 'application/vnd.snap',
  flatpak: 'application/vnd.flatpak',
  // source code → text/plain (filename preserves the extension)
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  py: 'text/plain',
  rb: 'text/plain',
  go: 'text/plain',
  rs: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  swift: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  cpp: 'text/plain',
  hpp: 'text/plain',
  cs: 'text/plain',
  php: 'text/plain',
  lua: 'text/plain',
  sh: 'text/plain',
  bash: 'text/plain',
  zsh: 'text/plain',
  sql: 'text/plain',
  r: 'text/plain',
  scala: 'text/plain',
  dart: 'text/plain',
  vue: 'text/plain',
  svelte: 'text/plain',
  // config → text/plain
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  log: 'text/plain',
}

export function getMimeTypeFromExtension(path: string | undefined): MimeType | null {
  if (!path) return null
  const ext = path.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (!ext) return null
  return extensionToMimeMap[ext] ?? null
}

export function extFromMime(mime?: string | null): Ext {
  // video
  if (mime === 'video/quicktime') return '.mov'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/x-m4v') return '.m4v'
  if (mime === 'video/x-msvideo' || mime === 'video/avi') return '.avi'
  if (mime === 'video/x-matroska') return '.mkv'
  if (mime === 'video/webm') return '.webm'
  if (mime === 'video/3gpp') return '.3gp'
  if (mime === 'video/3gpp2') return '.3g2'
  if (mime === 'video/mpeg') return '.mpeg'
  if (mime === 'video/x-ms-wmv') return '.wmv'
  if (mime === 'video/x-flv') return '.flv'
  if (mime === 'video/ogg') return '.ogv'
  // image
  if (mime === 'image/dng' || mime === 'image/x-adobe-dng' || mime === 'image/x-apple-proraw')
    return '.dng'
  if (mime === 'image/heic') return '.heic'
  if (mime === 'image/heif') return '.heif'
  if (mime === 'image/heic-sequence' || mime === 'image/heif-sequence') return '.heics'
  if (mime === 'image/avci') return '.avci'
  if (mime === 'image/avcs') return '.avcs'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/tiff') return '.tiff'
  if (mime === 'image/bmp') return '.bmp'
  if (mime === 'image/vnd.microsoft.icon' || mime === 'image/x-icon') return '.ico'
  if (mime === 'image/avif') return '.avif'
  if (mime === 'image/jxl') return '.jxl'
  if (mime === 'image/vnd.adobe.photoshop') return '.psd'
  if (mime === 'image/x-canon-cr2') return '.cr2'
  if (mime === 'image/x-canon-cr3') return '.cr3'
  if (mime === 'image/x-nikon-nef') return '.nef'
  if (mime === 'image/x-nikon-nrw') return '.nrw'
  if (mime === 'image/x-sony-arw') return '.arw'
  if (mime === 'image/x-fuji-raf') return '.raf'
  if (mime === 'image/x-olympus-orf') return '.orf'
  if (mime === 'image/x-panasonic-rw2') return '.rw2'
  if (mime === 'image/x-pentax-pef') return '.pef'
  // audio
  if (mime === 'audio/mpeg') return '.mp3'
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return '.m4a'
  if (mime === 'audio/aac') return '.aac'
  if (mime === 'audio/wav') return '.wav'
  if (mime === 'audio/flac') return '.flac'
  if (mime === 'audio/ogg') return '.ogg'
  if (mime === 'audio/opus') return '.opus'
  if (mime === 'audio/aiff') return '.aiff'
  if (mime === 'audio/x-caf') return '.caf'
  if (mime === 'audio/amr') return '.amr'
  if (mime === 'audio/x-ms-wma') return '.wma'
  if (mime === 'audio/midi') return '.midi'
  // text/docs
  if (mime === 'text/html') return '.html'
  if (mime === 'text/css') return '.css'
  if (mime === 'text/javascript') return '.js'
  if (mime === 'text/plain') return '.txt'
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return '.md'
  if (mime === 'application/json') return '.json'
  if (mime === 'application/yaml') return '.yaml'
  if (mime === 'application/toml') return '.toml'
  if (mime === 'application/pdf') return '.pdf'
  if (mime === 'text/xml') return '.xml'
  if (mime === 'text/csv') return '.csv'
  if (mime === 'image/svg+xml') return '.svg'
  // office / iwork / opendocument
  if (mime === 'application/msword') return '.doc'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return '.docx'
  if (mime === 'application/vnd.ms-excel') return '.xls'
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx'
  if (mime === 'application/vnd.ms-powerpoint') return '.ppt'
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    return '.pptx'
  if (mime === 'application/rtf') return '.rtf'
  if (mime === 'application/vnd.apple.pages') return '.pages'
  if (mime === 'application/vnd.apple.numbers') return '.numbers'
  if (mime === 'application/vnd.apple.keynote') return '.key'
  if (mime === 'application/vnd.oasis.opendocument.text') return '.odt'
  if (mime === 'application/vnd.oasis.opendocument.spreadsheet') return '.ods'
  if (mime === 'application/vnd.oasis.opendocument.presentation') return '.odp'
  if (mime === 'application/epub+zip') return '.epub'
  if (mime === 'application/x-mobipocket-ebook') return '.mobi'
  if (mime === 'application/vnd.amazon.ebook') return '.azw3'
  // archives
  if (mime === 'application/zip') return '.zip'
  if (mime === 'application/gzip') return '.gz'
  if (mime === 'application/x-tar') return '.tar'
  if (mime === 'application/x-7z-compressed') return '.7z'
  if (mime === 'application/vnd.rar') return '.rar'
  if (mime === 'application/x-bzip2') return '.bz2'
  if (mime === 'application/x-xz') return '.xz'
  if (mime === 'application/zstd') return '.zst'
  if (mime === 'application/x-iso9660-image') return '.iso'
  if (mime === 'application/vnd.ms-cab-compressed') return '.cab'
  // installers
  if (mime === 'application/x-apple-diskimage') return '.dmg'
  if (mime === 'application/vnd.microsoft.portable-executable') return '.exe'
  if (mime === 'application/x-msi') return '.msi'
  if (mime === 'application/vnd.debian.binary-package') return '.deb'
  if (mime === 'application/x-rpm') return '.rpm'
  if (mime === 'application/vnd.android.package-archive') return '.apk'
  if (mime === 'application/vnd.apple.installer+xml') return '.pkg'
  if (mime === 'application/x-iso9660-appimage') return '.appimage'
  if (mime === 'application/vnd.snap') return '.snap'
  if (mime === 'application/vnd.flatpak') return '.flatpak'
  return '.bin'
}

export function isMimeType(type?: string): type is MimeType {
  return MimeTypes.includes(type as MimeType)
}
