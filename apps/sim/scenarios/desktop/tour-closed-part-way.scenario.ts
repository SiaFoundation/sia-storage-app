import { defineScenario } from '../../src/scenario'
import { TOUR, WELCOME } from './sign-in'

export default defineScenario({
  name: 'closing the window part way through the tour ends the tour, and the next open shows the status view',
  description:
    'The desktop app signs in a new account and its tour opens. On the second slide the window is closed, the way its close button closes it. Opened again, the window shows the status view and the tour is gone.',
  devices: { mac: 'desktop-signed-out' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { mac }, step, check, waitFor }) {
    const ui = mac.ui().window('main')

    await step('the app opens its window on sign-in', () => ui.waitFor({ text: WELCOME }, 60_000))
    await step('ask to connect, which the network approves at once', () =>
      ui.tap({ text: 'Connect' }),
    )
    await step('save the new phrase and continue', async () => {
      await ui.waitFor({ text: 'Your recovery phrase' })
      await ui.tap({ label: 'I have written this down somewhere safe' })
      await ui.tap({ text: 'Continue' })
    })
    await step('the tour opens, and Next shows its second slide', async () => {
      await ui.waitFor({ text: TOUR[0] })
      await ui.tap({ text: 'Next' })
      await ui.waitFor({ text: TOUR[1] })
    })

    await step('close the window', async () => {
      await mac.ui().closeWindow('main')
      await waitFor('the window to close', async () => !(await mac.ui().isShowing('main')))
    })
    await step('open the window again', () => mac.openWindow())
    await step('it shows the status view', () => ui.waitFor({ id: 'files' }, 60_000))
    check('the tour is gone', (await ui.read({ id: 'tour-title' })) === null)
  },
})
