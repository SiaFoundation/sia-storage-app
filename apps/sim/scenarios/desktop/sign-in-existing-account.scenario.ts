import { defineScenario } from '../../src/scenario'
import {
  ACCOUNT_PHRASE,
  buttonEnabled,
  enterPhrase,
  setupReady,
  TOUR,
  UNUSED_PHRASE,
  WELCOME,
} from './sign-in'

export default defineScenario({
  name: 'a Mac signing in to an account that already has files is asked for its phrase and gets the library',
  description:
    "The laptop has four files in two folders on the account. The Mac starts with no account, and after approval its window asks for the existing recovery phrase instead of showing a new one. A valid phrase the account has never used is refused. The account's phrase continues to setup, which counts the files synced, and the folders appear in the Mac's Finder folder.",
  devices: { laptop: 'cli', mac: 'desktop-signed-out' },
  timeoutMs: 8 * 60_000,
  async run({
    devices: { laptop, mac },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
    capture,
  }) {
    const ui = mac.ui().window('main')

    await step('the laptop adds four files in two folders', async () => {
      await seed('laptop', { count: 2, size: 32 * 1024, dir: 'trips' })
      await seed('laptop', { count: 2, size: 32 * 1024, dir: 'work' })
      await converge(['laptop'])
    })

    await step('the Mac opens its window on sign-in', () => ui.waitFor({ text: WELCOME }, 60_000))
    await step('ask to connect', () => ui.tap({ text: 'Connect' }))
    await step("the window asks for the account's phrase", () =>
      ui.waitFor({ text: 'Welcome back' }),
    )
    checkEqual(
      'the network told the Mac it was reconnecting, and not the laptop before it',
      (await network.auth()).requests.map((r) => [r.device, r.reconnecting]),
      [
        ['laptop', false],
        ['mac', true],
      ],
    )

    await step('enter a valid phrase the account has never used', () =>
      enterPhrase(ui, UNUSED_PHRASE),
    )
    await step("the window says the phrase is not the account's", () =>
      ui.waitFor({ text: 'That phrase is not one this account has used with Sia Storage.' }),
    )
    check('Continue stays off for that phrase', !(await buttonEnabled(ui, 'Continue')))
    await capture('wrong-phrase', ['mac'])

    await step("enter the account's phrase", () => enterPhrase(ui, ACCOUNT_PHRASE))
    await step('Continue comes on', () =>
      waitFor('Continue to be enabled', () => buttonEnabled(ui, 'Continue')),
    )
    // Slowed so the first sync is still running when the next step looks.
    await step('slow the network', () => network.setConditions({ latencyMs: 1500 }))
    await step('continue', () => ui.tap({ text: 'Continue' }))
    await step('the tour opens', () => ui.waitFor({ text: TOUR[0] }))
    await step('the corner of the tour shows the first sync running', () =>
      waitFor(
        'the corner to name the sync',
        async () => (await ui.read({ id: 'setup-chip-label' })) === 'Syncing encrypted metadata',
        { timeoutMs: 60_000, intervalMs: 250 },
      ),
    )
    await capture('tour-with-setup-running', ['mac'])
    await step('skip the tour', () => ui.tap({ text: 'Skip' }))
    await step('setup shows the first sync running', () =>
      waitFor(
        'the metadata step to be running',
        async () => (await ui.read({ id: 'step-metadata' })) === 'Syncing encrypted metadata',
        { timeoutMs: 60_000, intervalMs: 250 },
      ),
    )
    await capture('setup-running', ['mac'])
    await step('restore the network', () => network.setConditions({ latencyMs: 0 }))

    await step('setup finishes', () => setupReady(ui, 180_000))
    await capture('setup-finished', ['mac'])
    checkEqual(
      'setup counts the files the first sync brought',
      await ui.read({ id: 'step-metadata-hint' }),
      '4 files',
    )
    checkEqual(
      'the network still holds one app key, since both devices use one phrase',
      (await network.auth()).appKeys.length,
      1,
    )

    await step('the Mac and the laptop agree', () => converge())
    checkEqual("the laptop's folders are in the Mac's Finder folder", mac.finderList().sort(), [
      'trips',
      'work',
    ])
    checkEqual('each folder holds its two files', mac.finderList('trips').length, 2)

    await step('Done shows the status view', async () => {
      await ui.tap({ text: 'Done' })
      await ui.waitFor({ id: 'status-message' }, 30_000)
    })
    checkEqual('the status view counts the four files', await ui.read({ id: 'files' }), '4')
    checkEqual('and their two folders', await ui.read({ id: 'folders' }), '2')
  },
})
