import type { SdkAuthAdapters } from '@siastorage/core/adapters'
import { MockSdk } from '@siastorage/sdk-mock'
import type { Bootstrap } from './app'

const MOCK_APP_KEY_HEX = 'ab'.repeat(32)
const MOCK_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * Builds a {@link Bootstrap} that uses MockSdk + stubbed auth adapters so the
 * daemon can run end-to-end without a real indexer. Selected by
 * `buildBootstrap()` in app.ts when `SIA_TEST_MODE=1`.
 */
export function createTestBootstrap(): Bootstrap {
  const sdkAdapter = new MockSdk()

  const authAdapters: SdkAuthAdapters = {
    createBuilder() {},
    async requestConnection() {
      return 'https://mock.indexer/approve'
    },
    async waitForApproval() {},
    async connectWithKey() {
      return true
    },
    async register() {
      return MOCK_APP_KEY_HEX
    },
    generateRecoveryPhrase() {
      return MOCK_PHRASE
    },
    validateRecoveryPhrase() {},
    cancelAuth() {},
  }

  return {
    authAdapters,
    sdkAuth: { adapters: authAdapters, getLastSdk: () => null },
    testSdkAdapter: sdkAdapter,
    async connect(app) {
      // MockSdk is already attached during createCliAppService — just flip
      // the connection flag and we're done.
      app.service.connection.setState({ isConnected: true })
      return true
    },
  }
}
