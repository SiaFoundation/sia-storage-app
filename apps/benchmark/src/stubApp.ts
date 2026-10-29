import { createAppService } from '@siastorage/core/app'
import type { DatabaseAdapter } from '@siastorage/core/adapters'
import type { ContentHash } from '@siastorage/core/lib/contentHash'
import { createInMemoryStorage } from '@siastorage/node-adapters/storage'
import { createHash } from 'crypto'

/** The size `importCopy` reports. The scanner refuses a zero-byte copy as an
 * empty file, and once unuploaded bytes pass IMPORT_PACED_BACKLOG_BYTES
 * (512 MB) it defers paced copies, so the size is small but not zero. */
const IMPORT_COPY_SIZE = 1024

/** A hash for the import scanner's callback that differs per copied file, so
 * no import finalizes as a duplicate of another. */
export function benchContentHash(uri: string): ContentHash {
  return `sha256:${createHash('sha256').update(uri).digest('hex')}`
}

/** The types the Android app's thumbnailer accepts. With no thumbnail adapter
 * the facade's `allowedTypes` is empty, and the thumbnail queries return
 * without running any SQL. */
const THUMBNAILABLE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
]

function notImplemented(): never {
  throw new Error('not implemented')
}

/** AppService over a real DB with inert platform adapters, enough for the
 * benchmark's facade reads and writes; anything touching the network or the
 * filesystem throws or returns empty. */
export function createStubAppService(db: DatabaseAdapter) {
  return createAppService({
    db,
    storage: createInMemoryStorage(),
    secrets: createInMemoryStorage(),
    crypto: { sha256: async () => '' },
    fsIO: {
      uri: (id) => `file:///bench/${id}.bin`,
      size: async () => ({ value: 0 }),
      remove: async () => {},
      copy: async () => ({ uri: 'file:///bench/managed.bin', size: 0 }),
      importCopy: async (file) => ({
        kind: 'plain',
        uri: `file:///bench/${file.id}.bin`,
        size: IMPORT_COPY_SIZE,
      }),
      writeFile: async () => ({ uri: 'file:///bench/managed.bin', size: 0 }),
      renameToType: async () => ({ uri: 'file:///bench/managed.bin' }),
      list: async () => [],
      ensureDirectory: async () => {},
    },
    downloadObject: {
      async download() {
        throw new Error('not implemented')
      },
      async downloadFromShareUrl() {
        throw new Error('not implemented')
      },
    },
    uploader: {
      toFilePath: (uri: string) => uri,
    },
    thumbnail: {
      thumbnailableTypes: THUMBNAILABLE_TYPES,
      generateImageThumbnail: notImplemented,
      generateImageThumbnails: notImplemented,
      generateVideoThumbnail: notImplemented,
    },
    sdkAuth: {
      createBuilder: async () => {},
      requestConnection: async () => '',
      waitForApproval: async () => {},
      connectWithKey: async () => false,
      register: async () => '',
      generateRecoveryPhrase: () => '',
      validateRecoveryPhrase: () => {},
      cancelAuth: () => {},
    },
  })
}
