/**
 * Core test setup.
 *
 * Philosophy: Use real implementations wherever possible.
 * Only mock things that require native bindings or network.
 *
 * Real:
 * - File system (via Node's fs)
 * - SQLite stores
 * - Thumbnailing (via sharp)
 * - Crypto (via Node's crypto)
 * - Service intervals (real timers, shorter durations)
 *
 * Mocked:
 * - SDK (no real Sia network)
 * - react-native-sia (native module)
 * - React Native platform APIs
 */

import * as path from 'path'

// Override config with test values BEFORE any imports use them
// Note: Values are inlined in jest.mock because jest.mock is hoisted
jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  SCANNER_INTERVAL: 1000,
  PACKER_IDLE_TIMEOUT: 1000,
  SLAB_SIZE: 10 * 1024,
  SLAB_FILL_THRESHOLD: 0.9,
  SYNC_EVENTS_INTERVAL: 2000,
  THUMBNAIL_SCANNER_INTERVAL: 1000,
  SYNC_UP_METADATA_INTERVAL: 2000,
  UPLOAD_DATA_SHARDS: 10,
  UPLOAD_PARITY_SHARDS: 20,
}))

// Logger - output to console for debugging
jest.mock('../../src/lib/logger', () => ({
  LOG_SERVICES: true,
  logger: {
    debug: jest.fn((...args: unknown[]) => {
      if (process.env.DEBUG_INTEGRATION) console.log('[DEBUG]', ...args)
    }),
    info: jest.fn((...args: unknown[]) => {
      if (process.env.DEBUG_INTEGRATION) console.log('[INFO]', ...args)
    }),
    warn: jest.fn((...args: unknown[]) => console.warn('[WARN]', ...args)),
    error: jest.fn((...args: unknown[]) => console.error('[ERROR]', ...args)),
    clear: jest.fn(),
  },
  rustLogger: {
    hasInitialized: false,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Expo constants
jest.mock('expo-constants', () => ({ EXDevLauncher: undefined }))

// React Native crypto - use Node's crypto (same algorithms)
jest.mock('react-native-quick-crypto', () => {
  const nodeCrypto = require('crypto')
  return {
    __esModule: true,
    default: {
      createHash: (algo: string) => {
        const inner = nodeCrypto.createHash(algo)
        const wrapper = {
          update(data: unknown, enc?: BufferEncoding) {
            if (data instanceof ArrayBuffer) {
              inner.update(Buffer.from(data), enc)
            } else {
              inner.update(data, enc)
            }
            return wrapper
          },
          digest(enc?: BufferEncoding) {
            return inner.digest(enc)
          },
        }
        return wrapper
      },
    },
  }
})

// React Native FS - use Node's fs
jest.mock('react-native-fs', () => {
  const fs = require('fs')
  return {
    __esModule: true,
    default: {
      stat: jest.fn((path: string) => {
        const stats = fs.statSync(path)
        return Promise.resolve({ size: stats.size, mtime: stats.mtime })
      }),
      read: jest.fn(),
      readFile: jest.fn((path: string, encoding?: string) => {
        return Promise.resolve(fs.readFileSync(path, encoding))
      }),
      hash: jest.fn((path: string, algo: string) => {
        const crypto = require('crypto')
        const content = fs.readFileSync(path)
        return Promise.resolve(
          crypto.createHash(algo).update(content).digest('hex'),
        )
      }),
    },
  }
})

// Expo FileSystem - use Node's fs with real operations
jest.mock('expo-file-system', () => {
  return require('./nodeFileSystem')
})

// React Native Sia - mock the native module with AppKey class
jest.mock('react-native-sia', () => ({
  AppKey: class MockAppKey {
    private data: ArrayBuffer
    constructor(data: ArrayBuffer) {
      this.data = data
    }
    export_(): ArrayBuffer {
      return this.data
    }
  },
}))

// Settings - enable auto features
jest.mock('../../src/stores/settings', () => ({
  ...jest.requireActual('../../src/stores/settings'),
  getIndexerURL: jest.fn().mockResolvedValue('https://test.indexer'),
  getAutoScanUploads: jest.fn().mockResolvedValue(true),
  getAutoSyncDownEvents: jest.fn().mockResolvedValue(true),
}))

// React Native platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: <T>(o: { ios?: T; native?: T; default?: T }) =>
      o?.ios ?? o?.native ?? o?.default,
  },
  Image: {
    getSize: jest.fn(
      (
        uri: string,
        success: (w: number, h: number) => void,
        failure: () => void,
      ) => {
        // Use sharp to get real image size
        const sharp = require('sharp')
        const { uriToPath } = require('./nodeFileSystem')
        const filePath = uriToPath(uri)

        sharp(filePath)
          .metadata()
          .then((meta: { width?: number; height?: number }) => {
            if (meta.width && meta.height) {
              success(meta.width, meta.height)
            } else {
              failure()
            }
          })
          .catch(() => failure())
      },
    ),
  },
}))

// Unique ID generator (deterministic for tests)
let mockUniqueIdCounter = 0
jest.mock('../../src/lib/uniqueId', () => ({
  uniqueId: () => `uid-${++mockUniqueIdCounter}`,
}))
beforeEach(() => {
  mockUniqueIdCounter = 0
})

// File reader - use real file reading via Node
jest.mock('../../src/lib/fileReader', () => ({
  createFileReader: jest.fn((uri: string) => {
    const fs = require('fs')
    const { uriToPath } = require('./nodeFileSystem')
    const filePath = uriToPath(uri)
    const fileData = fs.readFileSync(filePath)
    let position = 0

    return {
      read: jest.fn(async (dest: ArrayBuffer): Promise<bigint> => {
        if (position >= fileData.length) return 0n
        const destArray = new Uint8Array(dest)
        const bytesToRead = Math.min(
          destArray.length,
          fileData.length - position,
        )
        destArray.set(fileData.slice(position, position + bytesToRead))
        position += bytesToRead
        return BigInt(bytesToRead)
      }),
    }
  }),
}))

// Library SWR - keep as mock for simplicity, but include real query building functions
jest.mock('../../src/stores/library', () => ({
  ...jest.requireActual('../../src/stores/library'),
  librarySwr: {
    triggerChange: jest.fn(),
    addChangeCallback: jest.fn(),
    getKey: jest.fn((key: string) => key),
  },
}))

// Suppress expected warnings from Expo modules
const suppressedWarnings = [
  'EXNativeModulesProxy',
  'ExpoModulesCoreJSLogger',
  'ExponentConstants',
  'ExpoUpdates',
  'ExpoGo',
  '_reactNative.TurboModuleRegistry.get is not a function',
]
const originalConsoleWarn = console.warn
console.warn = (...args: unknown[]) => {
  const [message] = args
  if (
    typeof message === 'string' &&
    suppressedWarnings.some((pattern) => message.includes(pattern))
  ) {
    return
  }
  originalConsoleWarn(...args)
}

// Test assets directories
// E2E assets (test images used by multiple tests)
export const TEST_ASSETS_DIR = path.join(__dirname, '..', '..', 'e2e', 'assets')
// Core test specific assets
export const CORE_TEST_ASSETS_DIR = path.join(__dirname, '..', 'assets')
