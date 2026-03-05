jest.mock('@siastorage/core/config', () => ({
  ...jest.requireActual('@siastorage/core/config'),
  PACKER_POLL_INTERVAL: 1000,
  PACKER_IDLE_TIMEOUT: 1000,
  SLAB_SIZE: 10 * 1024,
  SLAB_FILL_THRESHOLD: 0.9,
  SYNC_EVENTS_INTERVAL: 2000,
  SYNC_UP_METADATA_INTERVAL: 2000,
  UPLOAD_DATA_SHARDS: 10,
  UPLOAD_PARITY_SHARDS: 20,
}))

jest.mock('@siastorage/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn((...args: unknown[]) => {
      if (process.env.DEBUG_CORE) console.warn('[WARN]', ...args)
    }),
    error: jest.fn((...args: unknown[]) => {
      if (process.env.DEBUG_CORE) console.error('[ERROR]', ...args)
    }),
    clear: jest.fn(),
  },
}))

jest.mock('@siastorage/core/lib/uniqueId', () => {
  let counter = 0
  return {
    uniqueId: () => `uid-${++counter}`,
  }
})
