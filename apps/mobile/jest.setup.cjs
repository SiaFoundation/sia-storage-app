jest.mock('@siastorage/logger', () => ({
  LOG_SERVICES: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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

// Ensure expo-constants is available for transitive expo modules (expo-asset/SQLite).
jest.mock('expo-constants', () => ({ EXDevLauncher: undefined }))

jest.mock('react-native-quick-crypto', () => {
  const nodeCrypto = require('crypto')
  return {
    __esModule: true,
    default: {
      // Wrap Node's Hash so update() also accepts ArrayBuffer like QuickCrypto typings.
      createHash: (algo) => {
        const inner = nodeCrypto.createHash(algo)
        const wrapper = {
          update(data, enc) {
            if (data instanceof ArrayBuffer) {
              inner.update(Buffer.from(data), enc)
            } else {
              inner.update(data, enc)
            }
            return wrapper
          },
          digest(enc) {
            return inner.digest(enc)
          },
        }
        return wrapper
      },
    },
  }
})

const rnfsExists = jest.fn().mockResolvedValue(true)
const rnfsStat = jest.fn().mockResolvedValue({ size: 100 })
const rnfsRead = jest.fn()
const rnfsReadDir = jest.fn().mockResolvedValue([])
const rnfsReadFile = jest.fn()
const rnfsHash = jest.fn()
const rnfsMkdir = jest.fn().mockResolvedValue(undefined)
const rnfsWriteFile = jest.fn().mockResolvedValue(undefined)
const rnfsCopyFile = jest.fn().mockResolvedValue(undefined)
const rnfsUnlink = jest.fn().mockResolvedValue(undefined)
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    exists: rnfsExists,
    stat: rnfsStat,
    read: rnfsRead,
    readDir: rnfsReadDir,
    readFile: rnfsReadFile,
    hash: rnfsHash,
    mkdir: rnfsMkdir,
    writeFile: rnfsWriteFile,
    copyFile: rnfsCopyFile,
    unlink: rnfsUnlink,
  },
}))
global.__rnfs = { rnfsExists, rnfsStat, rnfsRead, rnfsReadDir, rnfsReadFile, rnfsHash, rnfsMkdir, rnfsWriteFile, rnfsCopyFile, rnfsUnlink }

const { setExpoFileSystemMock } = require('./mocks/expo-file-system')

// Mock the Expo FileSystem API with a default implementation.
jest.mock('expo-file-system', () => setExpoFileSystemMock())
beforeEach(() => {
  setExpoFileSystemMock()
})

// Mock the fs store module with a default implementation.
const { setFsMock } = require('./mocks/fs')
jest.mock('./src/stores/fs', () => setFsMock())
beforeEach(() => {
  setFsMock()
})

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (o) => o?.ios ?? o?.native ?? o?.default,
  },
  Image: { getSize: jest.fn() },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}))

jest.mock('@siastorage/core/lib/uniqueId', () => {
  let c = 0
  return { uniqueId: () => `uid-${++c}` }
})

// These warnings are produced when Jest loads Expo modules without native bindings.
// In the test environment we intentionally replace those bindings with mocks, so
// the messages are expected noise and safe to ignore.
const suppressedWarnings = [
  'EXNativeModulesProxy',
  'ExpoModulesCoreJSLogger',
  'ExponentConstants',
  'ExpoUpdates',
  'ExpoGo',
  '_reactNative.TurboModuleRegistry.get is not a function',
]
const originalConsoleWarn = console.warn
console.warn = (...args) => {
  const [message] = args
  if (
    typeof message === 'string' &&
    suppressedWarnings.some((pattern) => message.includes(pattern))
  ) {
    return
  }
  originalConsoleWarn(...args)
}
