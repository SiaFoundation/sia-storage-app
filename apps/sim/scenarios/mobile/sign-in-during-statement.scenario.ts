import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'signing in again while a database statement runs leaves the app running',
  description:
    'Signing in runs the app’s setup a second time. A statement started just before keeps SQLite busy for several seconds. Setup finds the database already open and leaves the connection alone, and the app goes on answering.',
  devices: { phone: 'phone' },
  async run({ devices: { phone }, step, check }) {
    // A crash drops the call, so its outcome is read from the checks below.
    await step('start a slow statement, then run setup again as sign-in does', () =>
      phone.call('sim.reinitializeDuringStatement').catch(() => null),
    )
    check('the app is still running after its setup runs again', await phone.isRunning())
    const answers = await phone
      .call('files.queryCount', { order: 'ASC', includeThumbnails: true })
      .then(
        () => true,
        () => false,
      )
    check('the app answers a call after its setup runs again', answers)
  },
})
