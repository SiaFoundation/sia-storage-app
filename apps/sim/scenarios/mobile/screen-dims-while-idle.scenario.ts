import { defineScenario } from '../../src/scenario'

/** The dim manager's idle delay, plus room for the fade and a slow tree read. */
const IDLE_WAIT_MS = 75_000

export default defineScenario({
  name: 'the screen dims after a minute untouched while the phone stays awake, and a tap wakes it',
  description:
    'The phone turns on Stay awake during uploads and is left untouched. After the minute the app waits, the dim overlay covers the screen. A tap lifts it, and the screen dims again after another quiet minute until the phone goes to the background.',
  devices: { phone: 'phone' },
  timeoutMs: 8 * 60_000,
  async run({ devices: { phone }, step, check, precondition }) {
    const ui = phone.ui()
    await step('turn on Stay awake during uploads', async () => {
      await ui.tap({ label: 'Menu' })
      await ui.scrollTo({ label: 'Stay awake during uploads' })
      await ui.tap({ label: 'Stay awake during uploads' })
    })
    await precondition('the Menu is showing with the setting on', async () => {
      await ui.waitFor({ label: 'Stay awake during uploads' })
      return true
    })

    const dimmed = await ui
      .waitFor({ id: 'screen-dim' }, IDLE_WAIT_MS)
      .then(() => true)
      .catch(() => false)
    check('the screen dims after a minute untouched', dimmed)

    await step('tap the dimmed screen', () => ui.tap({ id: 'screen-dim' }))
    const woke = await ui
      .waitForGone({ id: 'screen-dim' }, 5_000)
      .then(() => true)
      .catch(() => false)
    check('a tap wakes the screen', woke)

    const dimmedAgain = await ui
      .waitFor({ id: 'screen-dim' }, IDLE_WAIT_MS)
      .then(() => true)
      .catch(() => false)
    check('it dims again after another quiet minute', dimmedAgain)

    await step('send the phone to the background and back', async () => {
      await phone.background()
      await phone.foreground()
    })
    check(
      'coming back from the background, the screen is not dimmed',
      await ui
        .waitForGone({ id: 'screen-dim' }, 5_000)
        .then(() => true)
        .catch(() => false),
    )
    await ui.close()
  },
})
