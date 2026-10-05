import type { SdkAdapter, SdkAuthAdapters } from '@siastorage/core/adapters'
import { createNodeRemoteAuth } from '@siastorage/mock-network/client/auth'
import { createNodeRemoteSdk } from '@siastorage/mock-network/client/node'
import { MOCK_APP_KEY_HEX, MOCK_PHRASE } from '@siastorage/mock-network/protocol'
import { MockSdk } from '@siastorage/sdk-mock'
import type { Bootstrap } from './app'

/**
 * Builds a {@link Bootstrap} with a mock SDK, so the daemon runs end to end
 * without a real indexer. Selected by `buildBootstrap()` in app.ts when
 * `SIA_TEST_MODE=1`.
 *
 * With `SIA_MOCK_NETWORK_URL` set the SDK is a client of that mock network,
 * shared with every other process pointed at it, and `SIA_SIM_DEVICE` names
 * this process in its request log. Sign-in goes to that network too, which
 * holds the app keys and settles connection requests, so a device can come up
 * signed out and sign in through its own screens. Without the URL the SDK is a
 * private in-memory MockSdk that no other process can see, and sign-in is
 * stubbed.
 */
export function createTestBootstrap(): Bootstrap {
  const networkUrl = process.env.SIA_MOCK_NETWORK_URL
  const device = process.env.SIA_SIM_DEVICE ?? `pid-${process.pid}`
  const sdkAdapter: SdkAdapter = networkUrl
    ? createNodeRemoteSdk({ url: networkUrl, device })
    : new MockSdk()

  const stubbedSignIn = {
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
    cancelAuth() {},
  }

  const authAdapters: SdkAuthAdapters = {
    ...(networkUrl ? createNodeRemoteAuth({ url: networkUrl, device }) : stubbedSignIn),
    generateRecoveryPhrase() {
      return MOCK_PHRASE
    },
    validateRecoveryPhrase() {},
  }

  return {
    authAdapters,
    sdkAuth: { adapters: authAdapters, getLastSdk: () => null },
    testSdkAdapter: sdkAdapter,
    async connect(app) {
      // On the mock network a device with no account stays disconnected, as it
      // does against a real indexer, which is what puts its sign-in on screen.
      // The key itself is not sent for checking: a device restarted while a
      // scenario holds it offline has always come up connected, and scenarios
      // that kill an offline device rely on that.
      if (networkUrl) {
        const indexerURL = await app.service.settings.getIndexerURL()
        if (!(await app.service.auth.hasAppKey(indexerURL))) {
          app.service.connection.setState({
            isConnected: false,
            connectionError: 'No account on this device',
          })
          return false
        }
      }
      // The mock SDK was attached in createCliAppService, so connecting is the
      // flag plus the uploader the real path starts.
      app.service.connection.setState({ isConnected: true, connectionError: null })
      app.internal.initUploader()
      return true
    },
  }
}
