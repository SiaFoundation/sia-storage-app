import { defineScenario } from '../../src/scenario'

/** The sign-in screen's heading. */
const SIGN_IN = 'Private storage, right in Finder'

/**
 * Past every read the window would make after a connection signal. The
 * status view polls 20 times after one, two seconds apart, and each poll waits
 * up to three seconds on the paused daemon, so a view that stopped polling
 * while the daemon could not answer has stopped by 100 seconds and would keep
 * saying Not running after it resumes.
 */
const PAUSED_MS = 150_000

export default defineScenario({
  name: 'a signed-in Mac never shows sign-in while its background service cannot answer, and shows its status once it does',
  description:
    "The Mac is signed in and its daemon is paused, as one migrating its database after an update or too busy to answer is, with its socket and the app's connection to it still open. Clicking the menu bar icon opens no window, and opening the window shows the status view rather than sign-in for as long as the daemon stays paused. Once it answers again, after a pause longer than the status view's polling after a connection signal, the window shows Up to date. A window that took the daemon's silence as no account would show sign-in over a signed-in library, and one that stopped asking would keep saying Not running, because with the connection still open nothing reports the recovery.",
  devices: { mac: 'desktop' },
  timeoutMs: 8 * 60_000,
  async run({ devices: { mac }, step, precondition, check, checkEqual, capture }) {
    const window = mac.ui().window('main')
    const signInShowing = async () =>
      (await mac.ui().isShowing('main')) && (await window.read({ text: SIGN_IN })) !== null

    await precondition('the Mac is signed in and no window is open', async () => {
      return (
        (await mac.call<boolean>(
          'auth.hasAppKey',
          await mac.call<string>('settings.getIndexerURL'),
        )) && !(await mac.ui().isShowing('main'))
      )
    })

    await precondition('pause the daemon', async () => {
      mac.pauseDaemon()
      return true
    })
    try {
      await step('click the menu bar icon', async () => {
        mac.ui().clickTray()
        // The app's two account reads take up to six seconds to fail.
        await Bun.sleep(8_000)
      })
      checkEqual(
        'clicking the menu bar icon while the daemon cannot answer opens no window',
        await mac.ui().isShowing('main'),
        false,
      )

      await step('open the window, as launching the app again does', () => mac.openWindow())
      await step('keep the daemon paused past every read the window makes', () =>
        Bun.sleep(PAUSED_MS),
      )
      await capture('window-while-paused', ['mac'])
      checkEqual(
        'the window does not show sign-in while the daemon cannot answer',
        await signInShowing(),
        false,
      )
    } finally {
      mac.resumeDaemon()
    }

    await step('wait for the window to show the status once the daemon answers', () =>
      window.waitFor({ text: 'Up to date' }, 30_000).catch(() => {}),
    )
    await capture('window-after-resume', ['mac'])
    check(
      'once the daemon answers, the window shows the status rather than sign-in',
      (await window.read({ id: 'status-message' }).catch(() => null)) === 'Up to date' &&
        !(await signInShowing()),
    )
  },
})
