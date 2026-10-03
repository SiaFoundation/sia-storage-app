import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a signed-in phone opens on the library, and Add files offers importing from Files',
  description:
    'After sign-in the phone shows the library screen, found by its Add files button in the accessibility tree rather than onboarding. Tapping Add files opens the sheet that offers Import from Files.',
  devices: { phone: 'phone' },
  timeoutMs: 15 * 60_000,
  async run({ devices, step, check, precondition }) {
    const ui = devices.phone.ui()
    // Opening the session can build WebDriverAgent. A failure there is the
    // harness, so it is a precondition rather than a wait the app fails.
    await precondition('the UI session opens', async () => (await ui.source()).length > 0)
    await step('wait for the library screen', () => ui.waitFor({ label: 'Add files' }, 60_000))
    check(
      'the welcome screen is not showing',
      !(await ui.isVisible({ id: 'welcome-sign-in-button' })),
    )
    await step('tap Add files', () => ui.tap({ label: 'Add files' }))
    await step('the sheet offers Import from Files', () =>
      ui.waitFor({ text: 'Import from Files' }),
    )
  },
})
