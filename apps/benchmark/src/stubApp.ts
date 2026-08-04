import { createAppService } from '@siastorage/core/app'
import type { DatabaseAdapter } from '@siastorage/core/adapters'
import { createInMemoryStorage } from '@siastorage/node-adapters/storage'

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
      exists: async () => false,
      remove: async () => {},
      stat: async () => ({ size: 0 }),
      readDir: async () => [],
      mkdir: async () => {},
      readFile: async () => new ArrayBuffer(0),
      writeFile: async () => {},
      copyFile: async () => {},
      moveFile: async () => {},
      getStorageDirectory: () => '',
      getTempDirectory: () => '',
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
      calculateContentHash: async () => '',
      getMimeType: async () => null,
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
