import type { SdkAdapter, SdkAuthAdapters } from '@siastorage/core/adapters'
import { createNodeRemoteSdk } from '@siastorage/mock-network/client/node'
import { MOCK_APP_KEY_HEX, MOCK_PHRASE } from '@siastorage/mock-network/protocol'
import { MockSdk } from '@siastorage/sdk-mock'
import type { Bootstrap } from './app'

/**
 * Builds a {@link Bootstrap} with stubbed auth and a mock SDK, so the daemon
 * runs end to end without a real indexer. Selected by `buildBootstrap()` in
 * app.ts when `SIA_TEST_MODE=1`.
 *
 * With `SIA_MOCK_NETWORK_URL` set the SDK is a client of that mock network,
 * shared with every other process pointed at it, and `SIA_SIM_DEVICE` names
 * this process in its request log. Without it the SDK is a private in-memory
 * MockSdk that no other process can see.
 */
export function createTestBootstrap(): Bootstrap {
  const networkUrl = process.env.SIA_MOCK_NETWORK_URL
  const sdkAdapter: SdkAdapter = networkUrl
    ? createNodeRemoteSdk({
        url: networkUrl,
        device: process.env.SIA_SIM_DEVICE ?? `pid-${process.pid}`,
      })
    : new MockSdk()

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
      // The mock SDK was attached in createCliAppService, so connecting is the
      // flag plus the uploader the real path starts.
      app.service.connection.setState({ isConnected: true, connectionError: null })
      app.internal.initUploader()
      return true
    },
  }
}
