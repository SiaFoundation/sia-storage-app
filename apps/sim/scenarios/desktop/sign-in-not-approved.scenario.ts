import { defineScenario } from '../../src/scenario'
import { buttonEnabled, WELCOME } from './sign-in'

export default defineScenario({
  name: 'a sign-in that is denied, cancelled or offline leaves the Mac on Connect with the reason',
  description:
    'The Mac starts with no account. Asking to connect while offline says the indexer could not be reached. A denied request says it was not approved. A request cancelled from the window stays unapproved on the network, and approving it afterwards does not move the window on. A request that is approved reaches the phrase screen, and Start over returns to Connect.',
  devices: { mac: 'desktop-signed-out' },
  timeoutMs: 5 * 60_000,
  async run({ devices: { mac }, network, step, check, checkEqual, waitFor, capture }) {
    const ui = mac.ui().window('main')
    const requestStates = async () => (await network.auth()).requests.map((r) => r.state)

    await step('the app opens its window on sign-in', () => ui.waitFor({ text: WELCOME }, 60_000))
    await step('hold approvals for the test to settle', () => network.setApprovalMode('manual'))

    await step('ask to connect while offline', async () => {
      await network.setOffline('mac', true)
      await ui.tap({ text: 'Connect' })
    })
    await step('the window says the indexer could not be reached', () =>
      ui.waitFor({ text: 'Could not reach the indexer. Check your connection and try again.' }),
    )
    checkEqual('no request reached the network', await requestStates(), [])
    await step('come back online', () => network.setOffline('mac', false))

    await step('ask to connect, and deny it', async () => {
      await ui.tap({ text: 'Connect' })
      await ui.waitFor({ text: 'Waiting for you to approve in your browser' })
      await network.deny()
    })
    await step('the window says it was not approved', () =>
      ui.waitFor({ text: 'The connection was not approved.' }),
    )
    await capture('not-approved', ['mac'])
    check('Connect can be tried again', await buttonEnabled(ui, 'Connect'))

    await step('ask to connect, and cancel from the window', async () => {
      await ui.tap({ text: 'Connect' })
      await ui.waitFor({ text: 'Waiting for you to approve in your browser' })
      await ui.tap({ text: 'Cancel' })
      await waitFor('Connect to come back', () => buttonEnabled(ui, 'Connect'))
    })
    checkEqual('the cancelled request is still unapproved', await requestStates(), [
      'denied',
      'pending',
    ])
    await step('approve the cancelled request late', async () => {
      await network.approve()
      await Bun.sleep(2000)
    })
    check(
      'a late approval of a cancelled request does not move the window on',
      (await ui.read({ text: WELCOME })) !== null &&
        (await ui.read({ text: 'Your recovery phrase' })) === null,
    )

    await step('ask to connect, and approve it', async () => {
      await ui.tap({ text: 'Connect' })
      await ui.waitFor({ text: 'Waiting for you to approve in your browser' })
      await network.approve()
      await ui.waitFor({ text: 'Your recovery phrase' })
    })
    await step('start over', () => ui.tap({ text: 'Start over' }))
    await step('the window is back on Connect', () => ui.waitFor({ text: WELCOME }))
    checkEqual('nothing was registered', (await network.auth()).appKeys, [])
    checkEqual(
      'the daemon is still not connected',
      (await mac.call<{ isConnected: boolean }>('connection.getState')).isConnected,
      false,
    )
  },
})
