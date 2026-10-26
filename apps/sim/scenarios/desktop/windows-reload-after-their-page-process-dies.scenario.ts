import { defineScenario } from '../../src/scenario'
import type { DesktopUi } from '../../src/devices/desktop-ui'

export default defineScenario({
  name: "the Mac's popover and window show their status again after the process drawing them is killed",
  description:
    'With the popover and the main window both open, the processes that draw their pages are killed and the app is left running, as a renderer crash or a stray pkill does. Each window reloads its page and shows Up to date again, and the popover opens from the menu bar icon with its status rather than an empty panel.',
  devices: { mac: 'desktop' },
  timeoutMs: 5 * 60_000,
  async run({ devices: { mac }, step, precondition, checkEqual, waitFor, capture }) {
    const popover = mac.ui().window('popover')
    const window = mac.ui().window('main')
    // A page whose process is gone does not answer, and that is the state
    // being waited out, so a failed read counts as nothing shown.
    const status = (ui: DesktopUi) => ui.read({ id: 'status-message' }).catch(() => null)

    await precondition('the popover and the window are open and up to date', async () => {
      await mac.openPopover()
      await popover.waitFor({ text: 'Up to date' }, 30_000)
      await popover.tap({ text: 'Open App' })
      await waitFor('the window to open', () => mac.ui().isShowing('main'))
      await window.waitFor({ text: 'Up to date' }, 30_000)
      return true
    })

    await precondition(
      'kill the processes drawing both pages',
      async () => mac.killRenderers() >= 2,
    )

    await step('wait for both pages to come back', () =>
      waitFor(
        'both windows to show their status again',
        async () =>
          (await status(popover)) === 'Up to date' && (await status(window)) === 'Up to date',
        { timeoutMs: 30_000, intervalMs: 1000 },
      ).catch(() => {}),
    )
    checkEqual(
      'both windows show their status again',
      { popover: await status(popover), window: await status(window) },
      { popover: 'Up to date', window: 'Up to date' },
    )

    // Not failed outright: with the page still gone the popover never reports
    // itself open, and the check below records what it shows instead.
    await step('open the popover from the menu bar icon', () => mac.openPopover().catch(() => {}))
    await capture('popover-after-kill', ['mac'])
    checkEqual('the popover opens on its status', await status(popover), 'Up to date')
  },
})
