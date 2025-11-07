jest.mock('./src/lib/logger', () => ({ logger: { log: jest.fn() } }))

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

const rnfsStat = jest.fn()
const rnfsRead = jest.fn()
const rnfsReadFile = jest.fn()
const rnfsHash = jest.fn()
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    stat: rnfsStat,
    read: rnfsRead,
    readFile: rnfsReadFile,
    hash: rnfsHash,
  },
}))
global.__rnfs = { rnfsStat, rnfsRead, rnfsReadFile, rnfsHash }

// In-memory SecureStore for tests.
jest.mock('./src/stores/secureStore', () => {
  const numStore = new Map()
  const boolStore = new Map()
  const strStore = new Map()
  return {
    __esModule: true,
    setSecureStoreNumber: jest.fn(async (key, value) => {
      numStore.set(key, value)
    }),
    getSecureStoreNumber: jest.fn(async (key, fallback = 0) => {
      return numStore.has(key) ? numStore.get(key) : fallback
    }),
    setSecureStoreBoolean: jest.fn(async (key, value) => {
      boolStore.set(key, value)
    }),
    getSecureStoreBoolean: jest.fn(async (key, fallback = false) => {
      return boolStore.has(key) ? boolStore.get(key) : fallback
    }),
    setSecureStoreString: jest.fn(async (key, value) => {
      strStore.set(key, value)
    }),
    getSecureStoreString: jest.fn(async (key, fallback) => {
      return strStore.has(key) ? strStore.get(key) : fallback
    }),
    setSecureStoreJSON: jest.fn(async (key, value) => {
      if (value == null) {
        strStore.set(key, '')
      } else {
        strStore.set(key, JSON.stringify(value))
      }
    }),
    getSecureStoreJSON: jest.fn(async (key, _codec, fallback) => {
      const v = strStore.get(key)
      if (typeof v !== 'string' || v.trim() === '') return fallback
      try {
        return JSON.parse(v)
      } catch {
        return fallback
      }
    }),
  }
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
