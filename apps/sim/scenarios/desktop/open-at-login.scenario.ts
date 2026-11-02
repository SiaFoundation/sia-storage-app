import { defineScenario } from '../../src/scenario'

/** The apps macOS opens at login, by name, as System Events lists them. */
function loginItems(): string[] {
  const out = Bun.spawnSync(
    ['osascript', '-e', 'tell application "System Events" to get the name of every login item'],
    { timeout: 15_000 },
  )
  return out.stdout
    .toString()
    .trim()
    .split(', ')
    .filter((name) => name !== '')
}

export default defineScenario({
  name: "the Mac's window turns opening at login on and off, and macOS lists the app only while it is on",
  description:
    "The status window's Open at login switch starts off in the test build, which does not turn it on by default. Turning it on makes macOS list the app under Login Items, the switch still reads on after the app is quit and opened again, and turning it off takes the app off the list.",
  devices: { mac: 'desktop' },
  timeoutMs: 5 * 60_000,
  async run({ devices: { mac }, step, checkEqual, waitFor, capture }) {
    const name = mac.identity.appName
    const listed = () => loginItems().includes(name)
    // Asked for each time, because a relaunch gives the app a new debugging port.
    const window = () => mac.ui().window('main')
    const switchOn = () => window().checked({ id: 'open-at-login' })
    const openWindow = async () => {
      await mac.openWindow()
      await window().waitFor({ id: 'open-at-login' }, 30_000)
    }

    await step('open the window', openWindow)
    checkEqual(
      'the test build starts with opening at login off',
      { switch: await switchOn(), listed: listed() },
      { switch: false, listed: false },
    )

    await step('turn the switch on', () => window().tap({ id: 'open-at-login' }))
    await waitFor('the switch to read on', async () => ((await switchOn()) ? true : undefined))
    await capture('open-at-login-on', ['mac'])
    // System Events reads the list macOS keeps, which takes the change a
    // moment after the app's own read of its status does.
    await waitFor('macOS to list the app under Login Items', () => (listed() ? true : undefined))
    checkEqual('macOS lists the app under Login Items', listed(), true)

    await step('quit the app and open it again', async () => {
      await mac.stop()
      await mac.start()
      await openWindow()
    })
    checkEqual('the switch still reads on after the app is opened again', await switchOn(), true)

    await step('turn the switch off', () => window().tap({ id: 'open-at-login' }))
    await waitFor('the switch to read off', async () =>
      (await switchOn()) === false ? true : undefined,
    )
    await waitFor('macOS to take the app off Login Items', () => (listed() ? undefined : true))
    checkEqual('macOS no longer lists the app under Login Items', listed(), false)
  },
})
