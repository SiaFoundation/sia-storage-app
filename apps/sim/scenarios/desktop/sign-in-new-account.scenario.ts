import { defineScenario } from '../../src/scenario'
import { ACCOUNT_PHRASE, buttonEnabled, shownPhrase, setupReady, TOUR, WELCOME } from './sign-in'

export default defineScenario({
  name: 'a Mac with no account signs in through its window and is set up',
  description:
    'The desktop app starts with no account and opens its window on Connect. The request waits until it is approved. The account is new, so the window shows a generated recovery phrase and will not continue until it is confirmed saved. The tour then shows its five slides while setup runs, with setup in its corner. Finishing it reaches setup, which lists each step as done and says where the app and the files are, and Done shows the status view.',
  devices: { mac: 'desktop-signed-out' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { mac }, network, step, check, checkEqual, waitFor, capture }) {
    const ui = mac.ui().window('main')
    const finderName = mac.identity.domainDisplay

    await step('the app opens its window on sign-in', () => ui.waitFor({ text: WELCOME }, 60_000))
    await capture('welcome', ['mac'])
    checkEqual(
      'the daemon is not connected before sign-in',
      (await mac.call<{ isConnected: boolean }>('connection.getState')).isConnected,
      false,
    )

    await step('hold the approval for the test to give', () => network.setApprovalMode('manual'))
    await step('ask to connect', () => ui.tap({ text: 'Connect' }))
    await step('the window says it is waiting for the approval', () =>
      ui.waitFor({ text: 'Waiting for you to approve in your browser' }),
    )
    await capture('waiting-for-approval', ['mac'])
    await step('approve the request', () => network.approve())

    await step('a new account is shown a recovery phrase to save', () =>
      ui.waitFor({ text: 'Your recovery phrase' }),
    )
    checkEqual('the phrase shown is the generated one', await shownPhrase(ui), ACCOUNT_PHRASE)
    check(
      'Continue is off until the phrase is confirmed saved',
      !(await buttonEnabled(ui, 'Continue')),
    )
    await capture('new-phrase', ['mac'])
    await step('confirm the phrase is saved', () =>
      ui.tap({ label: 'I have written this down somewhere safe' }),
    )
    await step('continue', () => ui.tap({ text: 'Continue' }))

    const seen: string[] = []
    await step('the tour opens and is read to its end', async () => {
      await ui.waitFor({ text: TOUR[0] })
      for (const [index] of TOUR.entries()) {
        seen.push((await ui.read({ id: 'tour-title' })) ?? '')
        // Each slide plays its arrival, and a capture is of the slide, not of that.
        await Bun.sleep(1200)
        await capture(`tour-${index + 1}`, ['mac'])
        if (index < TOUR.length - 1) await ui.tap({ text: 'Next' })
      }
    })
    checkEqual('the tour shows its five slides in order', seen, TOUR)
    checkEqual(
      'the phone slide offers the phone app with a code to scan',
      await ui.read({ id: 'tour-install-label' }),
      'Scan to install the companion app',
    )
    checkEqual(
      'the Finder slide names the folder this build uses',
      await (async () => {
        await ui.tap({ text: 'Back' })
        return ui.read({ id: 'finder-mock-location' })
      })(),
      finderName,
    )
    await step('the corner of the tour says setup is done', () =>
      waitFor(
        'the corner to say Ready',
        async () => (await ui.read({ id: 'setup-chip-label' })) === 'Ready',
        { timeoutMs: 120_000, intervalMs: 250 },
      ),
    )
    await step('finish the tour', async () => {
      await ui.tap({ text: 'Next' })
      await ui.tap({ text: 'Finish' })
    })

    await step('setup finishes', () => setupReady(ui, 120_000))
    await capture('setup-finished', ['mac'])
    checkEqual(
      'setup lists every step as done',
      {
        account: await ui.read({ id: 'step-account' }),
        finder: await ui.read({ id: 'step-finder' }),
        metadata: await ui.read({ id: 'step-metadata' }),
        folders: await ui.read({ id: 'step-folders' }),
      },
      {
        account: 'Connected to sia.storage',
        finder: `Added ${finderName} to Finder`,
        metadata: 'Synced encrypted metadata',
        folders: 'Folders ready in Finder',
      },
    )
    checkEqual(
      'an account with nothing in it says so',
      await ui.read({ id: 'step-metadata-hint' }),
      'No files yet',
    )
    check(
      'setup says where the app and the files are',
      (await ui.read({
        contains: `Your files are under ${finderName} in Finder`,
      })) !== null,
    )

    const state = await mac.call<{ isConnected: boolean }>('connection.getState')
    checkEqual('the daemon is connected after sign-in', state.isConnected, true)
    const sync = await mac.call<{ syncGateStatus: string }>('sync.getState')
    checkEqual('the first sync has been marked finished', sync.syncGateStatus, 'dismissed')
    const auth = await network.auth()
    checkEqual(
      'the network holds one app key, registered by the Mac',
      auth.appKeys.map((k) => k.device),
      ['mac'],
    )
    checkEqual(
      'the Mac was not told it was reconnecting',
      auth.requests.map((r) => r.reconnecting),
      [false],
    )

    await step('Done shows the status view', async () => {
      await ui.tap({ text: 'Done' })
      await ui.waitFor({ text: 'Up to date' }, 30_000)
    })
    check('the window is still open', await mac.ui().isShowing('main'))
    await capture('status-window', ['mac'])
    checkEqual(
      'the window shows the library and the connection',
      {
        files: await ui.read({ id: 'files' }),
        metadata: await ui.read({ id: 'metadata' }),
        connection: await ui.read({ id: 'connection' }),
        finderName: await ui.read({ id: 'finder-name' }),
      },
      { files: '0', metadata: 'Up to date', connection: 'Connected', finderName },
    )
    check(
      'setup has given way to the status view',
      (await ui.read({ id: 'setup-heading' })) === null,
    )
  },
})
