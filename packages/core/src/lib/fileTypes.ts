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

/**
 * A lookup table as a Map. A plain object would answer a lookup for a name
 * like "constructor" or "__proto__" with a member every object inherits.
 */
function lookupTable<V>(entries: Record<string, V>): ReadonlyMap<string, V> {
  return new Map(Object.entries(entries))
}

const extensionToMimeMap = lookupTable<MimeType>({
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
})

export function getMimeTypeFromExtension(path: string | undefined): MimeType | null {
  if (!path) return null
  const ext = path.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (!ext) return null
  return extensionToMimeMap.get(ext) ?? null
}

// Not the inverse of extensionToMimeMap: several extensions share one MIME type
// (qt/mov, mpg/mpeg), so the canonical extension per type is chosen here.
const mimeToExtMap = lookupTable<Ext>({
  // video
  'video/quicktime': '.mov',
  'video/mp4': '.mp4',
  'video/x-m4v': '.m4v',
  'video/x-msvideo': '.avi',
  'video/avi': '.avi',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/3gpp': '.3gp',
  'video/3gpp2': '.3g2',
  'video/mpeg': '.mpeg',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
  'video/ogg': '.ogv',
  // image
  'image/dng': '.dng',
  'image/x-adobe-dng': '.dng',
  'image/x-apple-proraw': '.dng',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/heic-sequence': '.heics',
  'image/heif-sequence': '.heics',
  'image/avci': '.avci',
  'image/avcs': '.avcs',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
  'image/vnd.microsoft.icon': '.ico',
  'image/x-icon': '.ico',
  'image/avif': '.avif',
  'image/jxl': '.jxl',
  'image/vnd.adobe.photoshop': '.psd',
  'image/x-canon-cr2': '.cr2',
  'image/x-canon-cr3': '.cr3',
  'image/x-nikon-nef': '.nef',
  'image/x-nikon-nrw': '.nrw',
  'image/x-sony-arw': '.arw',
  'image/x-fuji-raf': '.raf',
  'image/x-olympus-orf': '.orf',
  'image/x-panasonic-rw2': '.rw2',
  'image/x-pentax-pef': '.pef',
  // audio
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/aiff': '.aiff',
  'audio/x-caf': '.caf',
  'audio/amr': '.amr',
  'audio/x-ms-wma': '.wma',
  'audio/midi': '.midi',
  // text/docs
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/x-markdown': '.md',
  'application/json': '.json',
  'application/yaml': '.yaml',
  'application/toml': '.toml',
  'application/pdf': '.pdf',
  'text/xml': '.xml',
  'text/csv': '.csv',
  'image/svg+xml': '.svg',
  // office / iwork / opendocument
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/rtf': '.rtf',
  'application/vnd.apple.pages': '.pages',
  'application/vnd.apple.numbers': '.numbers',
  'application/vnd.apple.keynote': '.key',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/epub+zip': '.epub',
  'application/x-mobipocket-ebook': '.mobi',
  'application/vnd.amazon.ebook': '.azw3',
  // archives
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
  'application/x-7z-compressed': '.7z',
  'application/vnd.rar': '.rar',
  'application/x-bzip2': '.bz2',
  'application/x-xz': '.xz',
  'application/zstd': '.zst',
  'application/x-iso9660-image': '.iso',
  'application/vnd.ms-cab-compressed': '.cab',
  // installers
  'application/x-apple-diskimage': '.dmg',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/x-msi': '.msi',
  'application/vnd.debian.binary-package': '.deb',
  'application/x-rpm': '.rpm',
  'application/vnd.android.package-archive': '.apk',
  'application/vnd.apple.installer+xml': '.pkg',
  'application/x-iso9660-appimage': '.appimage',
  'application/vnd.snap': '.snap',
  'application/vnd.flatpak': '.flatpak',
})

export function extFromMime(mime?: string | null): Ext {
  return mimeToExtMap.get(mime ?? '') ?? '.bin'
}

export function isMimeType(type?: string): type is MimeType {
  return MimeTypes.includes(type as MimeType)
}
